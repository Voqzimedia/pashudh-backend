module.exports = ({ env }) => {
  // if(env('NODE_ENV') === 'production'){
  //     return {
  //         upload: {
  //             provider: 'aws-s3',
  //             providerOptions: {
  //                 accessKeyId: env('AWS_ACCESS_KEY_ID'),
  //                 secretAccessKey: env('AWS_ACCESS_SECRET'),
  //                 region: env('AWS_REGION'),
  //                 params: {
  //                     Bucket: env('AWS_BUCKET'),
  //                 },
  //             },
  //         },
  //     }
  // }

  return {
    //Empty config which will use defaults
    email: {
      provider: "smtp",
      providerOptions: {
        host: env("SMTP_HOST"), //SMTP Host
        port: env("SMTP_PORT"), //SMTP Port
        secure: true,
        username: env("SMTP_USERNAME"),
        password: env("SMTP_PASSWORD"),
        rejectUnauthorized: true,
        requireTLS: true,
        connectionTimeout: 1,
      },
      settings: {
        from: env("SMTP_USERNAME"),
        replyTo: env("SMTP_USERNAME"),
      },
    },
  };
};
