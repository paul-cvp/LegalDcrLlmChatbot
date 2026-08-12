import inherits from 'inherits-browser';

import CreateMoveSnapping from 'diagram-js/lib/features/snapping/CreateMoveSnapping';

/**
 * Snap during create and move.
 *
 * @param {EventBus} eventBus
 * @param {Injector} injector
 */
export default function DCRCreateMoveSnapping(injector) {
  injector.invoke(CreateMoveSnapping, this);
}

inherits(DCRCreateMoveSnapping, CreateMoveSnapping);

DCRCreateMoveSnapping.$inject = [
  'injector'
];

DCRCreateMoveSnapping.prototype.initSnap = function(event) {
  return CreateMoveSnapping.prototype.initSnap.call(this, event);
};

DCRCreateMoveSnapping.prototype.addSnapTargetPoints = function(snapPoints, shape, target) {
  return CreateMoveSnapping.prototype.addSnapTargetPoints.call(this, snapPoints, shape, target);
};

DCRCreateMoveSnapping.prototype.getSnapTargets = function(shape, target) {
  return CreateMoveSnapping.prototype.getSnapTargets.call(this, shape, target);
};
