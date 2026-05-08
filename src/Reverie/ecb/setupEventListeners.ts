import { PositionalCover } from '@ha/PositionalCover';
import { IMQTTConnection } from '@mqtt/IMQTTConnection';
import { ECBController } from './ECBController';

interface Cache {
  headMotor?: PositionalCover;
  feetMotor?: PositionalCover;
}

// Listens to BLE notify events from the head and foot motor characteristics.
// As the bed moves, it pushes single-byte position updates (0–100+).
// We forward those directly to the HA cover entities so HA shows live position.
export const setupEventListeners = (_mqtt: IMQTTConnection, controller: ECBController) => {
  const cache = controller.cache as Cache;

  controller.on('headNotify', (data: Uint8Array) => {
    cache.headMotor?.setPosition(data[0]);
  });

  controller.on('footNotify', (data: Uint8Array) => {
    cache.feetMotor?.setPosition(data[0]);
  });
};
