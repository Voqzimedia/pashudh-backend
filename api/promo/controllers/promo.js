"use strict";
const { sanitizeEntity } = require("strapi-utils");

const stripe = require("stripe")(process.env.STRIPE_PK);

const Razorpay = require("razorpay");

var razorpayInstance = new Razorpay({
  key_id: process.env.RAZORPAY_ID,
  key_secret: process.env.RAZORPAY_SECRET,
});

const voucher_codes = require("voucher-code-generator");

/**
 * Given a dollar amount number, convert it to it's value in cents
 * @param {Int} number
 */
const fromDecimalToInt = (number) => parseInt(number * 100);

/**
 * Read the documentation (https://strapi.io/documentation/v3.x/concepts/controllers.html#core-controllers)
 * to customize this controller
 */

const getToday = async () => {
  var today = new Date();
  var dd = String(today.getDate()).padStart(2, "0");
  var mm = String(today.getMonth() + 1).padStart(2, "0"); //January is 0!
  var yyyy = today.getFullYear();

  today = dd + mm + yyyy;

  return today;
};

module.exports = {
  /**
   * Only send back orders from you
   * @param {*} ctx
   */
  async find(ctx) {
    const { user } = ctx.state;
    let entities;
    if (ctx.query._q) {
      entities = await strapi.services.promo.search({
        ...ctx.query,
        user: user.id,
      });
    } else {
      entities = await strapi.services.promo.find({
        ...ctx.query,
        user: user.id,
      });
    }

    return entities.map((entity) =>
      sanitizeEntity(entity, { model: strapi.models.promo })
    );
  },
  /**
   * Retrieve an order by id, only if it belongs to the user
   */
  async findOne(ctx) {
    const { id } = ctx.params;
    const { user } = ctx.state;

    const entity = await strapi.services.promo.findOne({ id, user: user.id });
    return sanitizeEntity(entity, { model: strapi.models.promo });
  },

  /**
   * Create Orders
   * @param {*} ctx
   * @returns session
   */

  async create(ctx) {
    const BASE_URL = ctx.request.headers.origin || "http://localhost:3000"; //So we can redirect back

    const { giftcard, emailTo, paymentGateway } = ctx.request.body;
    const { user } = ctx.state; //From JWT

    // console.log({ giftcard, emailTo });

    if (!giftcard) {
      return res.status(400).send({ error: "Please add a giftcard to body" });
    }
    var i;

    var totalAmount = 0;

    var newPromos = [];
    var newPromoIds = "";

    for (i = 0; i < giftcard.length; i++) {
      const realGiftcard = await strapi.services.giftcard.findOne({
        slug: giftcard[i].slug,
      });
      if (realGiftcard) {
        totalAmount = totalAmount + realGiftcard.price;

        const today = await getToday();

        const promoCode = voucher_codes.generate({
          length: 6,
          prefix: "pashudh-",
          postfix: `-${today}`,
        });

        const newPromo = await strapi.services.promo.create({
          promoCode: promoCode[0],
          giftcard: realGiftcard.id,
          user: user.id,
          promoPrice: realGiftcard.price,
          emailTo: emailTo ? emailTo : user.email,
        });

        newPromoIds = newPromoIds + `#${newPromo.id},`;

        newPromos.push(newPromo);
      }

      if (!realGiftcard) {
        return res.status(400).send({ error: "Giftcard is not found" });
      }
    }

    // console.log(totalAmount);

    // console.log({ newPromos, totalAmount });

    // console.log({ realGiftcard, promoCode });

    // //TODO Create Temp Promo here

    if (paymentGateway == "Stripe") {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: fromDecimalToInt(totalAmount),
        currency: "inr",
        metadata: {
          Customer_Name: user.username,
          Customer_Email: user.email,
          User_Phone: user.phone,
          Site_Url: BASE_URL,
          Order_Id: `Promo Id ${newPromoIds}`,
        },
        receipt_email: user.email,
        description: `Pashudh PromoId #${newPromoIds}`,
      });

      for (i = 0; i < newPromos.length; i++) {
        // console.log(newPromos[i].id);
        const updatePromo = await strapi.services.promo.update(
          {
            id: newPromos[i].id,
          },
          {
            transactionId: paymentIntent.id,
          }
        );

        // console.log(updatePromo);
      }

      return {
        client_secret: paymentIntent.client_secret,
      };
    } else {
      var options = {
        amount: fromDecimalToInt(totalAmount), // amount in the smallest currency unit
        currency: "INR",
        receipt: `Pashudh PromoId ${newPromoIds}`,
      };

      var order = await razorpayInstance.orders.create(options);

      for (i = 0; i < newPromos.length; i++) {
        const updatePromo = await strapi.services.promo.update(
          {
            id: newPromos[i].id,
          },
          {
            transactionId: order.id,
          }
        );
      }

      return {
        order,
      };
    }

    // return {
    //   data: true,
    // };
  },

  async validate(ctx) {
    const { code } = ctx.params;

    // console.log(code);

    if (!code) {
      return null;
    }

    const entity = await strapi.services.promo.findOne({ promoCode: code });

    if (!entity) {
      return null;
    }

    const tempData = {
      promoCode: entity.promoCode,
      price: entity.promoPrice,
      isValid: !entity.redeemed,
      giftcard: entity.giftcard.name,
      id: entity.id,
    };

    return tempData;
  },

  /**
   * Payment Confirm for the order
   * @param {*} ctx
   * @returns
   */

  async confirm(ctx) {
    const { transactionId } = ctx.request.body;

    const paymentIntent = await stripe.paymentIntents.retrieve(transactionId);

    // console.log("verify session", paymentIntent.status);

    if (paymentIntent.status === "succeeded") {
      //Update order
      const updatePromo = await strapi.services.promo.update(
        {
          transactionId,
        },
        {
          paid: true,
        }
      );
      return sanitizeEntity(updatePromo, { model: strapi.models.promo });
    } else {
      ctx.throw(
        400,
        "It seems like the promo wasn't verified, please contact support"
      );
    }

    return { status: true };
  },
  /**
   * Payment Confirm for the order
   * @param {*} ctx
   * @returns
   */

  async confirmRazerpay(ctx) {
    const { transaction } = ctx.request.body;

    // const paymentIntent = await stripe.paymentIntents.retrieve(transactionId);

    // console.log("verify session", paymentIntent.status);

    var thisPromo = await strapi.services.promo.findOne({
      transactionId: transaction.razorpay_order_id,
    });

    if (thisPromo) {
      //Update order
      const updatePromo = await strapi.services.promo.update(
        {
          transactionId: transaction.razorpay_order_id,
        },
        {
          paid: true,
          transactionId: transaction.razorpay_payment_id,
        }
      );

      const updatedPromo = await strapi.services.promo.findOne({
        transactionId: transaction.razorpay_payment_id,
      });

      return sanitizeEntity(updatedPromo, { model: strapi.models.promo });
    } else {
      ctx.throw(
        400,
        "It seems like the promo wasn't verified, please contact support"
      );
    }

    return { status: true };
  },
};
