// happy-dom lacks the SVG transform-list API used by diagram-js.
const transform = {
  baseVal: {
    clear() {},
    appendItem(item) { return item; },
    consolidate() { return null; },
    createSVGTransformFromMatrix(matrix) { return { matrix }; },
  },
};

const createElementNS = document.createElementNS.bind(document);
document.createElementNS = function(namespace, name, options) {
  const element = createElementNS(namespace, name, options);
  if (namespace === "http://www.w3.org/2000/svg") {
    Object.defineProperty(element, "transform", {
      configurable: true,
      value: transform,
    });
  }
  return element;
};
