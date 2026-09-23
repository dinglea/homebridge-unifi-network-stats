import { AccessoryPlugin, API, Logger, Service } from 'homebridge';

// HomeKit's CurrentAmbientLightLevel range.
const clamp = (ms: number): number => Math.min(Math.max(Number.isFinite(ms) ? ms : 0, 0.0001), 100000);

/** Internet latency in milliseconds, shown as a Light Sensor (1 ms = 1 lux). */
export class LatencySensorAccessory implements AccessoryPlugin {
  private readonly service: Service;
  private readonly info: Service;
  private latency = 0;

  constructor(private readonly log: Logger, private readonly api: API, public readonly name: string) {
    const { Service: S, Characteristic: C } = api.hap;
    this.service = new S.LightSensor(name);
    this.service.getCharacteristic(C.CurrentAmbientLightLevel).onGet(() => clamp(this.latency));
    this.info = new S.AccessoryInformation()
      .setCharacteristic(C.Manufacturer, 'Ubiquiti')
      .setCharacteristic(C.Model, 'WAN latency')
      .setCharacteristic(C.SerialNumber, 'unifi-wan-latency');
  }

  getServices(): Service[] {
    return [this.info, this.service];
  }

  /** A null reading (UniFi reported no latency, e.g. while offline) keeps the last value. */
  updateLatency(ms: number | null): void {
    if (ms === null) {
      this.log.debug(`${this.name}: no latency reported`);
      return;
    }
    this.latency = ms;
    this.service.updateCharacteristic(this.api.hap.Characteristic.CurrentAmbientLightLevel, clamp(ms));
    this.log.debug(`${this.name}: ${ms} ms`);
  }
}
