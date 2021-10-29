"use strict";
const { sanitizeEntity } = require("strapi-utils");

var hmac_sha256 = require("crypto-js/hmac-sha256");

// const stripe = require("stripe")(process.env.STRIPE_PK);
const Razorpay = require("razorpay");

var razorpayInstance = new Razorpay({
  key_id: process.env.RAZORPAY_ID,
  key_secret: process.env.RAZORPAY_SECRET,
});

const fromDecimalToInt = (number) => parseInt(number * 100);

const isRealProduct = async (slug) => {
  const realProduct = await strapi.services.product.findOne({ slug: slug });

  return realProduct;
};

module.exports = {
  async findMyOrders(ctx) {
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

  async findMyOrder(ctx) {
    const { id } = ctx.params;
    const { user } = ctx.state;

    const entity = await strapi.services.order.findOne({ id, user: user.id });
    return sanitizeEntity(entity, { model: strapi.models.order });
  },

  async checkout(ctx) {
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

    var i;

    const cartArray = [];
    const line_items = [];

    var totalAmount = 0;

    var promo = {
      id: null,
      promoPrice: 0,
    };

    var { user } = ctx.state; //From JWT

    if (!user) {
      user = await strapi.plugins["users-permissions"].services.user.fetch({
        email,
      });
      // console.log(user);
      if (!user) {
        const advanced = await strapi
          .store({
            environment: "",
            type: "plugin",
            name: "users-permissions",
            key: "advanced",
          })
          .get();

        const defaultRole = await strapi
          .query("role", "users-permissions")
          .findOne({ type: advanced.default_role }, []);

        user = await strapi.plugins["users-permissions"].services.user.add({
          email: email.toLowerCase(),
          username: name,
          provider: "local",
          confirmed: false,
          role: defaultRole.id,
          phone,
        });
      }
    }

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
      totalAmount = totalAmount - user.redeemPoints / 100;
    }

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

    if (paymentGateway == "Razorpay") {
      const newOrder = await strapi.services.order.create({
        user: user.id,
        total: totalAmount,
        Cart: cartArray,
        address: addressTxt,
        userEmail: email,
        userPhone: phone,
        userName: name,
        promo: promo.id,
        paymentGateway: paymentGateway.name,
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
    } else {
      console.log("COD");
    }

    // console.log(newOrder);

    // return {
    //   status: true,
    // };
  },

  async confirm(ctx) {
    return {
      status: true,
    };
  },

  async fullfill(ctx) {
    const { id } = ctx.params;
    const { user } = ctx.state;

    const { body } = ctx.request;

    const entity = await strapi.services.order.findOne({ id, status: "paid" });

    if (!entity) {
      return res.status(400).send({ error: "Order is not processble" });
    }

    const FullfilledOrder = await strapi.services.order.update(
      {
        id: entity.id,
      },
      {
        status: "completed",
        Shipping: body,
      }
    );

    // console.log({ FullfilledOrder });

    return sanitizeEntity(FullfilledOrder, { model: strapi.models.order });
  },

  async confirmRazerpay(ctx) {
    const { transaction, discount, useRedeemPoints } = ctx.request.body;

    var thisOrder = await strapi.services.order.findOne({
      transactionId: transaction.razorpay_order_id,
    });

    const { user } = ctx.state; //From JWT

    const generated_signature = hmac_sha256(
      transaction.razorpay_order_id + "|" + transaction.razorpay_payment_id,
      process.env.RAZORPAY_SECRET
    );

    if (generated_signature == transaction.razorpay_signature) {
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
                { redeemPoints: updatedOrder.total }
              );
            } else {
              const updateRedeem = await strapi.plugins[
                "users-permissions"
              ].services.user.edit(
                { id: user.id },
                { redeemPoints: user.redeemPoints + updatedOrder.total }
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
    } else {
      ctx.throw(
        400,
        "It seems like the Payment wasn't verified, please contact support"
      );
    }
  },
};
