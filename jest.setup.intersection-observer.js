/* eslint-disable no-underscore-dangle */
// jsdom does not implement IntersectionObserver; stub it so hooks that use it don't throw.
// Plain JS to avoid TypeScript/ESLint restrictions on type assertions and class rules.
//
// The stub records every constructed observer and the elements it observes on `global.ioInstances`
// so tests can drive intersections deterministically. `triggerIntersection(el, isIntersecting)`
// finds the observer watching `el` and invokes its callback with a minimal entry.
global.ioInstances = [];

global.IntersectionObserver = function IntersectionObserver(callback, options) {
  const targets = new Set();
  const instance = {
    callback,
    options,
    targets,
    observe(el) {
      targets.add(el);
    },
    unobserve(el) {
      targets.delete(el);
    },
    disconnect() {
      targets.clear();
      const i = global.ioInstances.indexOf(instance);
      if (i !== -1) global.ioInstances.splice(i, 1);
    },
    takeRecords() {
      return [];
    },
  };
  global.ioInstances.push(instance);
  return instance;
};

// Fires an intersection for `el` on whichever observer is watching it.
global.triggerIntersection = function triggerIntersection(el, isIntersecting) {
  global.ioInstances.forEach((instance) => {
    if (instance.targets.has(el)) {
      instance.callback([{ target: el, isIntersecting }], instance);
    }
  });
};
