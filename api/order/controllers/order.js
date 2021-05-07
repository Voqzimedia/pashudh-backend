"use strict";
const { sanitizeEntity } = require("strapi-utils");

const stripe = require("stripe")(process.env.STRIPE_PK);

/**
 * Given a dollar amount number, convert it to it's value in cents
 * @param number
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
   * @param {cartItems:Array} ctx
   * @returns session
   */

  async create(ctx) {
    const BASE_URL = ctx.request.headers.origin || "http://localhost:3000"; //So we can redirect back

    const { cartItems, address } = ctx.request.body;

    if (!cartItems) {
      return res.status(400).send({ error: "Please add a cart items to body" });
    }

    //Retrieve the real product here
    // const realProduct = await strapi.services.product.findOne({
    //   id: product.id,
    // });
    // if (!realProduct) {
    //   return res.status(404).send({ error: "This product doesn't exist" });
    // }

    var i;

    const cartArray = [];
    const line_items = [];

    var totalAmount = 0;

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

    var addressTxt = `${address.line1}, ${address.line2}, ${address.city} - ${address.postal_code},${address.state},${address.country}`;

    // console.log({ cartArray, totalAmount, user, address, addressTxt });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: line_items,
      customer_email: user.email, //Automatically added by Magic Link
      mode: "payment",
      success_url: `${BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: BASE_URL,
    });

    // console.log(session);

    //TODO Create Temp Order here
    const newOrder = await strapi.services.order.create({
      user: user.id,
      total: totalAmount,
      checkout_session: session.id,
      Cart: cartArray,
      address: addressTxt,
      transactionId: session.payment_intent,
      userEmail: user.email,
      userPhone: user.phone,
    });

    return { session: session.id, payment_intent: session.payment_intent };

    // return { status: true };
  },
  async confirm(ctx) {
    const { checkout_session } = ctx.request.body;
    console.log("checkout_session", checkout_session);
    const session = await stripe.checkout.sessions.retrieve(checkout_session);
    console.log("verify session", session);

    if (session.payment_status === "paid") {
      //Update order
      const newOrder = await strapi.services.order.update(
        {
          checkout_session,
        },
        {
          status: "paid",
        }
      );

      return newOrder;
    } else {
      ctx.throw(
        400,
        "It seems like the order wasn't verified, please contact support"
      );
    }
  },
};
