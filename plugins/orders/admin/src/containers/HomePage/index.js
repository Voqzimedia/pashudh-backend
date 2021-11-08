/*
 *
 * HomePage
 *
 */

import axios from "axios";
import React, { memo, useEffect } from "react";
// import PropTypes from 'prop-types';
import {
  CheckPagePermissions,
  LoadingIndicatorPage,
  NotFound,
  request,
} from "strapi-helper-plugin";
import pluginId from "../../pluginId";
// import ListView from "../../containers-new/ListView";
// import * as strapi from "strapi-helper-plugin";

const HomePage = () => {
  // const orders = strapi.services.order.find();

  useEffect(() => {}, []);

  // axios.get(`${strapi?.backendURL}/orders`).then((res) => console.log(res));

  return <div></div>;
};

export default memo(HomePage);
