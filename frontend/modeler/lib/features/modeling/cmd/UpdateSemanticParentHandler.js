export default function UpdateSemanticParentHandler(dcrUpdater) {
  this._dcrUpdater = dcrUpdater;
}

UpdateSemanticParentHandler.$inject = [ 'dcrUpdater' ];


UpdateSemanticParentHandler.prototype.execute = function(context) {
  var dataStoreBo = context.dataStoreBo,
      newSemanticParent = context.newSemanticParent,
      newDiParent = context.newDiParent;

  context.oldSemanticParent = dataStoreBo.$parent;
  context.oldDiParent = dataStoreBo.di.$parent;

  // update semantic parent
  this._dcrUpdater.updateSemanticParent(dataStoreBo, newSemanticParent);

  // update DI parent
  this._dcrUpdater.updateDiParent(dataStoreBo.di, newDiParent);
};

UpdateSemanticParentHandler.prototype.revert = function(context) {
  var dataStoreBo = context.dataStoreBo,
      oldSemanticParent = context.oldSemanticParent,
      oldDiParent = context.oldDiParent;

  // update semantic parent
  this._dcrUpdater.updateSemanticParent(dataStoreBo, oldSemanticParent);

  // update DI parent
  this._dcrUpdater.updateDiParent(dataStoreBo.di, oldDiParent);
};

