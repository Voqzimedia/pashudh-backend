module.exports = ({ env }) => {
  if (env("NODE_ENV") === "production") {
    return {
      upload: {
        provider: "cloudinary",
        providerOptions: {
          cloud_name: env("CLOUDINARY_NAME"),
          api_key: env("CLOUDINARY_KEY"),
          api_secret: env("CLOUDINARY_SECRET"),
        },
      },
    };
  }

  // return {
  //   //SMTP Config
  //   email: {
  //     provider: "smtp",
  //     providerOptions: {
  //       host: env("SMTP_HOST"), //SMTP Host
  //       port: env("SMTP_PORT"), //SMTP Port
  //       secure: true,
  //       username: env("SMTP_USERNAME"),
  //       password: env("SMTP_PASSWORD"),
  //       rejectUnauthorized: true,
  //       requireTLS: true,
  //       connectionTimeout: 1,
  //     },
  //     settings: {
  //       from: env("SMTP_USERNAME"),
  //       replyTo: env("SMTP_USERNAME"),
  //     },
  //   },
  // };

  return {
    email: {
      provider: "sendgrid",
      providerOptions: {
        apiKey: env("SENDGRID_API_KEY"),
      },
      settings: {
        defaultFrom: "vinoth@voqzi.com",
        defaultReplyTo: "vinoth@voqzi.com",
      },
    },
  };
};
