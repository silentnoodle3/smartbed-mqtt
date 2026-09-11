import { IBLEDevice } from 'ESPHome/types/IBLEDevice';

export const isSupported = ({ advertisement: { serviceUuidsList } }: IBLEDevice) =>
  serviceUuidsList.includes('db801000-f324-29c3-38d1-85c0c2e86885');
