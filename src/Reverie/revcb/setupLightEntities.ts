import { IMQTTConnection } from '@mqtt/IMQTTConnection';
import { buildCommandSwitch } from 'Common/buildCommandSwitch';
import { Commands } from './Commands';
import { RevCBController } from './RevCBController';

export const setupLightEntities = (mqtt: IMQTTConnection, controller: RevCBController) => {
  buildCommandSwitch('Reverie', mqtt, controller, 'UnderBedLights', Commands.Light(100), Commands.Light(0));
};
