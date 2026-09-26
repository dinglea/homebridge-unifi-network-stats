import { AccessoryPlugin, API, CharacteristicValue, Logger, Service } from 'homebridge';

/** Whether every adopted UniFi device (APs, switches, gateway) is connected: closed = all connected, open = any offline. */
export class DeviceStatusAccessory implements AccessoryPlugin {
  private readonly service: Service;
  private readonly info: Service;
  private offline = 0;

  constructor(private readonly log: Logger, private readonly api: API, public readonly name: string) {
    const { Service: S, Characteristic: C } = api.hap;
    this.service = new S.ContactSensor(name);
    this.service.getCharacteristic(C.ContactSensorState).onGet(() => this.state());
    this.info = new S.AccessoryInformation()
      .setCharacteristic(C.Manufacturer, 'Ubiquiti')
      .setCharacteristic(C.Model, 'Device Status Sensor')
      .setCharacteristic(C.SerialNumber, 'unifi-device-status');
  }

  private state(): CharacteristicValue {
    const S = this.api.hap.Characteristic.ContactSensorState;
    return this.offline > 0 ? S.CONTACT_NOT_DETECTED : S.CONTACT_DETECTED;
  }

  getServices(): Service[] {
    return [this.info, this.service];
  }

  /** A null reading (UniFi reported no device counts) keeps the last state. */
  updateOffline(offline: number | null): void {
    if (offline === null) {
      this.log.debug(`${this.name}: no device counts reported`);
      return;
    }
    this.offline = offline;
    this.service.updateCharacteristic(this.api.hap.Characteristic.ContactSensorState, this.state());
    this.log.debug(`${this.name}: ${offline} device(s) offline`);
  }
}
