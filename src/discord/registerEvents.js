import * as readyEvent from '../events/ready.js';
import * as messageCreateEvent from '../events/messageCreate.js';

const events = [readyEvent, messageCreateEvent];

export function registerEvents(client, context) {
  for (const event of events) {
    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args, context));
    } else {
      client.on(event.name, (...args) => event.execute(...args, context));
    }
  }
}
