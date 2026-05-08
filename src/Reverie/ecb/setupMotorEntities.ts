import { PositionalCover } from '@ha/PositionalCover';
import { IMQTTConnection } from '@mqtt/IMQTTConnection';
import { buildEntityConfig } from 'Common/buildEntityConfig';
import { ECBController } from './ECBController';

interface Cache {
  headMotor?: PositionalCover;
  feetMotor?: PositionalCover;
}

// Creates HA cover entities for the head and foot motors.
//
// Writing a position value (0–100+) to the motor characteristic tells the
// bed to move to that position autonomously. Live position feedback arrives
// via BLE notify and is handled in setupEventListeners.
//
// Note: no stop command is implemented in v1. The bed will finish moving
// to any commanded position on its own. Add stop support once the
// stop/abort characteristic is identified.
export const setupMotorEntities = (mqtt: IMQTTConnection, controller: ECBController) => {
  const { deviceData, writeHead, writeFoot } = controller;
  const cache = controller.cache as Cache;

  if (!cache.headMotor) {
    cache.headMotor = new PositionalCover(
      mqtt,
      deviceData,
      buildEntityConfig('MotorHead', { icon: 'mdi:head' }),
      async (position) => await writeHead(position),
      {}
    ).setOnline();
  }

  if (!cache.feetMotor) {
    cache.feetMotor = new PositionalCover(
      mqtt,
      deviceData,
      buildEntityConfig('MotorFeet', { icon: 'mdi:foot-print' }),
      async (position) => await writeFoot(position),
      {}
    ).setOnline();
  }
};
