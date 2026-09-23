import { PositionalCover } from '@ha/PositionalCover';
import { IMQTTConnection } from '@mqtt/IMQTTConnection';
import { buildEntityConfig } from 'Common/buildEntityConfig';
import { ICache } from 'Common/ICache';
import { Commands } from './Commands';
import { RevCBController } from './RevCBController';

interface Cache {
  headMotor?: PositionalCover;
  feetMotor?: PositionalCover;
}

// The bed can drive directly to an absolute position and stop there on its own -
// confirmed via a live capture of the official app's position slider, which writes
// the target straight to the same characteristic used for position feedback. So
// these are full PositionalCover entities (drag-to-position in Home Assistant sends
// the same kind of command the app's own slider does), with live position notify
// wired in to keep the reported position current. STOP uses the separate
// hold-to-move motor's stop code to interrupt an in-progress move.
export const setupMotorEntities = (mqtt: IMQTTConnection, controller: RevCBController & ICache<Cache>) => {
  const { cache, deviceData, writeCommand, on } = controller;

  if (!cache.headMotor) {
    cache.headMotor = new PositionalCover(
      mqtt,
      deviceData,
      buildEntityConfig('MotorHead', { icon: 'mdi:head' }),
      (position) => writeCommand(Commands.HeadTo(position)),
      { onStop: () => writeCommand(Commands.HeadStop), retain: true }
    ).setOnline();
    on('headPosition', (data) => cache.headMotor!.setPosition(data[0]));
  }

  if (!cache.feetMotor) {
    cache.feetMotor = new PositionalCover(
      mqtt,
      deviceData,
      buildEntityConfig('MotorFeet', { icon: 'mdi:foot-print' }),
      (position) => writeCommand(Commands.FootTo(position)),
      { onStop: () => writeCommand(Commands.FootStop), retain: true }
    ).setOnline();
    on('footPosition', (data) => cache.feetMotor!.setPosition(data[0]));
  }
};
