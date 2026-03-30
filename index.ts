import { API } from 'homebridge';
import { UnifiNetworkStatsPlatform } from './platform';

export = (api: API) => {
  api.registerPlatform('UnifiNetworkStats', UnifiNetworkStatsPlatform);
};