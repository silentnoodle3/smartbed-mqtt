import { RevCBCommand } from './RevCBController';

// Reverse engineered from a live BLE capture (Android HCI snoop log) of the official
// Reverie Nightstand app controlling a Reverie 3EMT king adjustable base. Unlike the
// `simple` Reverie variant, there is no shared header/checksum framing here - each
// value is written directly, raw, to its own characteristic.
export const Commands = {
  // Written to the `preset` characteristic - a simple sequential enumeration.
  PresetZeroG: { target: 'preset', value: [0x01] } as RevCBCommand,
  PresetAntiSnore: { target: 'preset', value: [0x02] } as RevCBCommand,
  PresetFlat: { target: 'preset', value: [0x03] } as RevCBCommand,
  PresetMemory1: { target: 'preset', value: [0x04] } as RevCBCommand,
  PresetMemory2: { target: 'preset', value: [0x05] } as RevCBCommand,
  PresetMemory3: { target: 'preset', value: [0x06] } as RevCBCommand,
  PresetMemory4: { target: 'preset', value: [0x07] } as RevCBCommand,

  // Head/foot motors run continuously in the given direction until a stop command
  // is written - there is no device-side "move to position" support.
  HeadUp: { target: 'headMotor', value: [0x01] } as RevCBCommand,
  HeadDown: { target: 'headMotor', value: [0x02] } as RevCBCommand,
  HeadStop: { target: 'headMotor', value: [0x00] } as RevCBCommand,

  FootUp: { target: 'footMotor', value: [0x01] } as RevCBCommand,
  FootDown: { target: 'footMotor', value: [0x02] } as RevCBCommand,
  FootStop: { target: 'footMotor', value: [0x00] } as RevCBCommand,

  // 0 = off, 1-100 = brightness.
  Light: (brightness: number): RevCBCommand => ({ target: 'light', value: [brightness] }),
};
