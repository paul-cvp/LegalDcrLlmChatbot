import {
  assign, map, pick,
} from 'min-dash';

import {
  isAny
} from './util/ModelingUtil';

import {
  is
} from '../../util/ModelUtil';


export default function DcrFactory(moddle) {
  this._model = moddle;
}

DcrFactory.$inject = [ 'moddle' ];


DcrFactory.prototype._needsId = function(element) {
  return isAny(element, [
    'dcr:BoardElement'
  ]);
};

DcrFactory.prototype._ensureId = function(element) {

  // generate semantic ids for elements         //tlk
  // dcr:Event -> Object_ID
  var prefix;

  if (is(element, 'dcr:Event')) {
    prefix = 'Event';
  } else {
    prefix = (element.$type || '').replace(/^[^:]*:/g, '');
  }

  prefix += '_';

  if (!element.id && this._needsId(element)) {
    element.id = this._model.ids.nextPrefixed(prefix, element);
  }
};


DcrFactory.prototype.create = function(type, attrs) {
  var element = this._model.create(type, attrs || {});
  if (type === 'dcr:Event') {
    element.label = '';
    element.description = '';
  }

  this._ensureId(element);

  return element;
};


DcrFactory.prototype.createDiLabel = function() {
  return this.create('dcrDi:OdLabel', {
    bounds: this.createDiBounds()
  });
};


DcrFactory.prototype.createDiShape = function(semantic, bounds, attrs) {

  return this.create('dcrDi:DcrShape', assign({
    boardElement: semantic,
    bounds: this.createDiBounds(bounds)
  }, attrs));
};


DcrFactory.prototype.createDiBounds = function(bounds) {
  return this.create('dc:Bounds', bounds);
};

DcrFactory.prototype.createDiEdge = function(semantic, waypoints, attrs) {
  return this.create('dcrDi:Relation', assign({
    boardElement: semantic
  }, attrs));
};


DcrFactory.prototype.createDiPlane = function(semantic) {
  return this.create('dcrDi:DcrPlane', {
    boardElement: semantic
  });
};

DcrFactory.prototype.createDiWaypoints = function(waypoints) {
  var self = this;

  return map(waypoints, function(pos) {
    return self.createDiWaypoint(pos);
  });
};

DcrFactory.prototype.createDiWaypoint = function(point) {
  return this.create('dc:Point', pick(point, [ 'x', 'y' ]));
};
