"use strict";
const { sanitizeEntity } = require("strapi-utils");

const stripe = require("stripe")(process.env.STRIPE_PK);
const Razorpay = require("razorpay");

var razorpayInstance = new Razorpay({
  key_id: process.env.RAZORPAY_ID,
  key_secret: process.env.RAZORPAY_SECRET,
});

/**
 * Given a dollar amount number, convert it to it's value in cents
 * @param {Int} number
 */
const fromDecimalToInt = (number) => parseInt(number * 100);

/**
 * Read the documentation (https://strapi.io/documentation/v3.x/concepts/controllers.html#core-controllers)
 * to customize this controller
 */

/**
 * Retrieve the real product here ?
 * @param {String} slug
 * @returns
 */
const isRealProduct = async (slug) => {
  const realProduct = await strapi.services.product.findOne({ slug: slug });

  return realProduct;
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
      entities = await strapi.services.order.search({
        ...ctx.query,
        user: user.id,
      });
    } else {
      entities = await strapi.services.order.find({
        ...ctx.query,
        user: user.id,
      });
    }

    return entities.map((entity) =>
      sanitizeEntity(entity, { model: strapi.models.order })
    );
  },
  /**
   * Retrieve an order by id, only if it belongs to the user
   */
  async findOne(ctx) {
    const { id } = ctx.params;
    const { user } = ctx.state;

    const entity = await strapi.services.order.findOne({ id, user: user.id });
    return sanitizeEntity(entity, { model: strapi.models.order });
  },

  /**
   * Create Orders
   * @param {*} ctx
   * @returns session
   */

  async create(ctx) {
    const BASE_URL = ctx.request.headers.origin || "http://localhost:3000"; //So we can redirect back

    const {
      cartItems,
      address,
      name,
      email,
      phone,
      saveMe,
      discount,
      paymentGateway,
      useRedeemPoints,
    } = ctx.request.body;

    if (!cartItems) {
      return res.status(400).send({ error: "Please add a cart items to body" });
    }

    // console.log({ useRedeemPoints });

    var i;

    const cartArray = [];
    const line_items = [];

    var totalAmount = 0;

    var promo = {
      id: null,
      promoPrice: 0,
    };

    const { user } = ctx.state; //From JWT

    for (i = 0; i < cartItems.length; i++) {
      var realProduct = await isRealProduct(cartItems[i].slug);

      var tempData = {
        product: realProduct,
        quantity: cartItems[i].quantity,
      };

      var tempLineItems = {
        price_data: {
          currency: "inr",
          product_data: {
            name: realProduct.name,
          },
          unit_amount: fromDecimalToInt(realProduct.price),
        },
        quantity: cartItems[i].quantity,
      };

      if (realProduct) {
        cartArray.push(tempData);
        line_items.push(tempLineItems);
        totalAmount += realProduct.price * cartItems[i].quantity;
      }
    }

    var addressTxt = `${address.line1}, ${
      address.line2 ? address.line2 + "," : ""
    } ${address.city} - ${address.postal_code},${address.state},${
      address.country
    }`;

    if (discount) {
      var tempPromo = await strapi.services.promo.findOne({
        promoCode: discount.promoCode,
      });

      promo = tempPromo;

      totalAmount = totalAmount - promo.promoPrice;
    }

    if (useRedeemPoints) {
      totalAmount = totalAmount - user.redeemPoints / 10;
    }

    // const session = await stripe.checkout.sessions.create({
    //   payment_method_types: ["card"],
    //   line_items: line_items,
    //   customer_email: user.email, //Automatically added by Magic Link
    //   mode: "payment",
    //   success_url: `${BASE_URL}/api/paymentIntent?session_id={CHECKOUT_SESSION_ID}`,
    //   cancel_url: BASE_URL,
    //   billing_address_collection: "required",
    // });

    // console.log(session);

    // console.log({ totalAmount });

    //TODO Create Temp Order here

    if (saveMe == "on") {
      const newAddress = await strapi.services.address.create({
        user: user.id,
        line1: address.line1,
        line2: address.line2,
        city: address.city,
        postal_code: address.postal_code,
        state: address.state,
        country: address.country,
        email: email,
        phone: phone,
      });
    }

    if (paymentGateway == "Stripe") {
      const newOrder = await strapi.services.order.create({
        user: user.id,
        total: totalAmount,
        Cart: cartArray,
        address: addressTxt,
        userEmail: email,
        userPhone: phone,
        userName: name,
        promo: promo.id,
        paymentGateway: paymentGateway,
      });

      const paymentIntent = await stripe.paymentIntents.create({
        amount: fromDecimalToInt(totalAmount),
        currency: "inr",
        metadata: {
          Customer_Name: name,
          Customer_Email: email,
          User_Phone: phone,
          Site_Url: BASE_URL,
          Order_Id: `OrderId #${newOrder.id}`,
        },
        receipt_email: email,
        description: `Pashudh OrderId #${newOrder.id}`,
      });

      const updateOrder = await strapi.services.order.update(
        {
          id: newOrder.id,
        },
        {
          transactionId: paymentIntent.id,
        }
      );

      return {
        client_secret: paymentIntent.client_secret,
      };
    } else {
      // console.log(razorpayInstance);

      const newOrder = await strapi.services.order.create({
        user: user.id,
        total: totalAmount,
        Cart: cartArray,
        address: addressTxt,
        userEmail: email,
        userPhone: phone,
        userName: name,
        promo: promo.id,
        paymentGateway: paymentGateway,
      });

      var options = {
        amount: fromDecimalToInt(totalAmount), // amount in the smallest currency unit
        currency: "INR",
        receipt: `Pashudh OrderId #${newOrder.id}`,
      };

      var order = await razorpayInstance.orders.create(options);

      // console.log(order);

      const updateOrder = await strapi.services.order.update(
        {
          id: newOrder.id,
        },
        {
          transactionId: order.id,
        }
      );

      return {
        order,
      };
    }

    // console.log(newOrder);

    // return {
    //   status: true,
    // };
  },

  /**
   * Payment Confirm for the order
   * @param {*} ctx
   * @returns
   */

  async confirm(ctx) {
    const { transactionId, discount, useRedeemPoints } = ctx.request.body;

    const paymentIntent = await stripe.paymentIntents.retrieve(transactionId);

    const { user } = ctx.state; //From JWT

    // console.log("verify session", paymentIntent.status);

    if (paymentIntent.status === "succeeded") {
      if (discount) {
        var tempPromo = await strapi.services.promo.findOne({
          promoCode: discount.promoCode,
        });

        const redeemPromo = await strapi.services.promo.update(
          {
            id: tempPromo.id,
          },
          {
            redeemed: true,
          }
        );
      }

      //Update order
      const newOrder = await strapi.services.order.update(
        {
          transactionId,
        },
        {
          status: "paid",
        }
      );

      if (newOrder) {
        if (user) {
          if (useRedeemPoints) {
            const updateRedeem = await strapi.plugins[
              "users-permissions"
            ].services.user.edit(
              { id: user.id },
              { redeemPoints: newOrder.total }
            );
          } else {
            const updateRedeem = await strapi.plugins[
              "users-permissions"
            ].services.user.edit(
              { id: user.id },
              { redeemPoints: user.redeemPoints + newOrder.total }
            );
          }

          // console.log(updateRedeem);
        }

        try {
          await strapi.plugins[
            "email-designer"
          ].services.email.sendTemplatedEmail(
            {
              to: newOrder.userEmail, // required
            },
            {
              templateId: 1, // required - you can get the template id from the admin panel (can change on import)
              sourceCodeToTemplateId: 55, // ID that can be defined in the template designer (won't change on import)
            },
            {
              // this object must include all variables you're using in your email template
              order: {
                cart: newOrder.Cart,
                id: newOrder.id,
                total: newOrder.total,
              },
            }
          );
        } catch (err) {
          strapi.log.debug("📺: ", err);
          return ctx.badRequest(null, err);
        }
      }

      return sanitizeEntity(newOrder, { model: strapi.models.order });
    } else {
      ctx.throw(
        400,
        "It seems like the order wasn't verified, please contact support"
      );
    }
  },

  /**
   * Payment Confirm for the order
   * @param {*} ctx
   * @returns
   */

  async confirmRazerpay(ctx) {
    const { transaction, discount } = ctx.request.body;

    // const paymentIntent = await stripe.paymentIntents.retrieve(transactionId);

    var thisOrder = await strapi.services.order.findOne({
      transactionId: transaction.razorpay_order_id,
    });

    const { user } = ctx.state; //From JWT

    // console.log({ transaction, thisOrder });

    if (thisOrder) {
      if (discount) {
        var tempPromo = await strapi.services.promo.findOne({
          promoCode: discount.promoCode,
        });

        const redeemPromo = await strapi.services.promo.update(
          {
            id: tempPromo.id,
          },
          {
            redeemed: true,
          }
        );
      }

      //Update order
      const newOrder = await strapi.services.order.update(
        {
          transactionId: transaction.razorpay_order_id,
        },
        {
          status: "paid",
          transactionId: transaction.razorpay_payment_id,
        }
      );

      const updatedOrder = await strapi.services.order.findOne({
        transactionId: transaction.razorpay_payment_id,
      });

      // console.log(updatedOrder);

      if (updatedOrder) {
        if (user) {
          if (useRedeemPoints) {
            const updateRedeem = await strapi.plugins[
              "users-permissions"
            ].services.user.edit(
              { id: user.id },
              { redeemPoints: newOrder.total }
            );
          } else {
            const updateRedeem = await strapi.plugins[
              "users-permissions"
            ].services.user.edit(
              { id: user.id },
              { redeemPoints: user.redeemPoints + newOrder.total }
            );
          }

          // console.log(updateRedeem);
        }

        try {
          await strapi.plugins[
            "email-designer"
          ].services.email.sendTemplatedEmail(
            {
              to: updatedOrder.userEmail, // required
            },
            {
              templateId: 1, // required - you can get the template id from the admin panel (can change on import)
              sourceCodeToTemplateId: 55, // ID that can be defined in the template designer (won't change on import)
            },
            {
              // this object must include all variables you're using in your email template
              order: {
                cart: updatedOrder.Cart,
                id: updatedOrder.id,
                total: updatedOrder.total,
              },
            }
          );
        } catch (err) {
          strapi.log.debug("📺: ", err);
          return ctx.badRequest(null, err);
        }
      }

      return sanitizeEntity(updatedOrder, { model: strapi.models.order });
    } else {
      ctx.throw(
        400,
        "It seems like the order wasn't verified, please contact support"
      );
    }

    // return {
    //   status: true,
    // };
  },
};
