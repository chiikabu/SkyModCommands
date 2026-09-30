import { App } from './ui/app.js';

const app = new App();
// handy for debugging from the console
window.__cc = {
  app,
  get game() { return app.game; },
  get view() { return app.view; },
  advance(seconds) {
    const g = app.game;
    for (let i = 0; i < seconds * 60; i++) {
      g.step();
      const ev = g.drainEvents();
      app.view.handleEvents(ev, null);
      if (app.hud) for (const e of ev) app.hud.onEvent(e);
    }
  },
};
