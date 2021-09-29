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

    // console.log({ giftcard, emailTo, paymentGateway });

    const today = await getToday();

    const promoCode = voucher_codes.generate({
      length: 6,
      prefix: "pashudh-",
      postfix: `-${today}`,
    });

    // console.log({ realGiftcard, promoCode });

    // //TODO Create Temp Promo here

    if (paymentGateway.name == "Razorpay") {
      const newPromo = await strapi.services.promo.create({
        promoCode: promoCode[0].toUpperCase(),
        user: user.id,
        promoPrice: giftcard.total,
        emailTo: emailTo ? emailTo : user.email,
      });

      var options = {
        amount: fromDecimalToInt(giftcard.total), // amount in the smallest currency unit
        currency: "INR",
        receipt: `Pashudh PromoId #${newPromo.id}`,
      };

      var order = await razorpayInstance.orders.create(options);

      const updatePromo = await strapi.services.promo.update(
        {
          id: newPromo.id,
        },
        {
          transactionId: order.id,
        }
      );

      return {
        order,
      };
    } else {
      return {
        paymentGateway,
      };
    }
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
      isValid: !entity.redeemed && entity.paid,
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
