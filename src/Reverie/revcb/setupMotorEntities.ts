import { Cover } from '@ha/Cover';
import { IMQTTConnection } from '@mqtt/IMQTTConnection';
import { buildEntityConfig } from 'Common/buildEntityConfig';
import { ICache } from 'Common/ICache';
import { Commands } from './Commands';
import { RevCBController } from './RevCBController';

interface Cache {
  headMotor?: Cover;
  feetMotor?: Cover;
}

// This control box only supports "start moving in a direction" / "stop" - there is no
// device-side support for driving to an absolute position - so these are plain
// open/close/stop covers rather than PositionalCover. See setupPositionSensors for
// the raw position feedback the device does report.
export const setupMotorEntities = (mqtt: IMQTTConnection, controller: RevCBController & ICache<Cache>) => {
  const { cache, deviceData, writeCommand } = controller;

  if (!cache.headMotor) {
    cache.headMotor = new Cover(mqtt, deviceData, buildEntityConfig('MotorHead', { icon: 'mdi:head' }), (command) => {
      switch (command) {
        case 'OPEN':
          return void writeCommand(Commands.HeadUp);
        case 'CLOSE':
          return void writeCommand(Commands.HeadDown);
        case 'STOP':
          return void writeCommand(Commands.HeadStop);
      }
    }).setOnline();
  }

  if (!cache.feetMotor) {
    cache.feetMotor = new Cover(
      mqtt,
      deviceData,
      buildEntityConfig('MotorFeet', { icon: 'mdi:foot-print' }),
      (command) => {
        switch (command) {
          case 'OPEN':
            return void writeCommand(Commands.FootUp);
          case 'CLOSE':
            return void writeCommand(Commands.FootDown);
          case 'STOP':
            return void writeCommand(Commands.FootStop);
        }
      }
    ).setOnline();
  }
};
