import { Connection } from '@2colors/esphome-native-api';
import EventEmitter from 'events';
import { ESPConnection } from './ESPConnection';

const buildConnection = () => {
  const connection = new EventEmitter() as unknown as jest.Mocked<Connection> & EventEmitter;
  connection.subscribeBluetoothAdvertisementService = jest.fn();
  return connection;
};

describe(ESPConnection.name, () => {
  it('re-subscribes to Bluetooth when the proxy link is re-established', () => {
    const connection = buildConnection();
    new ESPConnection([connection]);

    // what esphome-native-api emits after transparently reconnecting a dropped proxy link
    connection.emit('authorized');

    expect(connection.subscribeBluetoothAdvertisementService).toHaveBeenCalledTimes(1);
  });

  it('does not throw if re-subscribing fails', () => {
    const connection = buildConnection();
    connection.subscribeBluetoothAdvertisementService.mockImplementation(() => {
      throw new Error('Not authorized');
    });
    new ESPConnection([connection]);

    expect(() => connection.emit('authorized')).not.toThrow();
  });
});
