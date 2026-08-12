import { every } from 'min-dash';

import inherits from 'inherits-browser';

import { is } from '../../util/ModelUtil';

import { isLabel } from '../../util/LabelUtil';

import RuleProvider from 'diagram-js/lib/features/rules/RuleProvider';
import { isAny } from '../modeling/util/ModelingUtil';

/**
 * DCR specific modeling rule
 */
export default function DCRRules(eventBus) {
  RuleProvider.call(this, eventBus);
}

inherits(DCRRules, RuleProvider);

DCRRules.$inject = ['eventBus'];

DCRRules.prototype.init = function () {
  this.addRule('connection.start', function (context) {
    var source = context.source;

    return canStartConnection(source);
  });

  this.addRule('connection.create', function (context) {
    var source = context.source,
      target = context.target,
      hints = context.hints || {},
      targetParent = hints.targetParent;

    // temporarily set target parent for scoping
    // checks to work
    if (targetParent) {
      target.parent = targetParent;
    }

    try {
      return canConnect(source, target);
    } finally {
      // unset temporary target parent
      if (targetParent) {
        target.parent = null;
      }
    }
  });

  this.addRule('connection.reconnect', function (context) {
    var connection = context.connection,
      source = context.source,
      target = context.target;

    return canConnect(source, target, connection);
  });

  this.addRule('connection.updateWaypoints', function (context) {
    return {
      type: context.connection.type,
    };
  });

  this.addRule('shape.resize', function (context) {
    var shape = context.shape,
      newBounds = context.newBounds;

    return canResize(shape, newBounds);
  });

  this.addRule('elements.create', function (context) {
    var elements = context.elements,
      position = context.position,
      target = context.target;

    return every(elements, function (element) {
      if (element.host) {
        return canAttach(element, element.host, null, position);
      }

      return canCreate(element, target, null, position);
    });
  });

  this.addRule('elements.move', function (context) {
    var target = context.target,
      shapes = context.shapes,
      position = context.position;

    return (
      canAttach(shapes, target, null, position) ||
      canMove(shapes, target, position)
    );
  });

  this.addRule('shape.create', function (context) {
    return canCreate(
      context.shape,
      context.target,
      context.source,
      context.position
    );
  });

  this.addRule('shape.attach', function (context) {
    return canAttach(context.shape, context.target, null, context.position);
  });

  this.addRule('element.copy', function (context) {
    var element = context.element,
      elements = context.elements;

    return canCopy(elements, element);
  });
};

DCRRules.prototype.canConnect = canConnect;

DCRRules.prototype.canMove = canMove;

DCRRules.prototype.canAttach = canAttach;

DCRRules.prototype.canDrop = canDrop;

DCRRules.prototype.canCreate = canCreate;

DCRRules.prototype.canReplace = canReplace;

DCRRules.prototype.canResize = canResize;

DCRRules.prototype.canCopy = canCopy;

DCRRules.prototype.isLinkAllowed = isLinkAllowed;

DCRRules.prototype.canHaveLabel = canHaveLabel;

/**
 * Utility functions for rule checking
 */

function isSame(a, b) {
  return a === b;
}

function getParents(element) {
  var parents = [];

  while (element) {
    element = element.parent;

    if (element) {
      parents.push(element);
    }
  }

  return parents;
}

function isParent(possibleParent, element) {
  var allParents = getParents(element);
  return allParents.indexOf(possibleParent) !== -1;
}

function isGroup(element) {
  return is(element, 'dcr:Group') && !element.labelTarget;
}

/**
 * Checks if given element can be used for starting connection.
 *
 * @param  {Element} element
 * @return {boolean}
 */
function canStartConnection(element) {
  if (nonExistingOrLabel(element)) {
    return null;
  }

  return isAny(element, ['dcr:Event', 'dcr:Nesting', 'dcr:SubProcess']) &&
    !(is(element, 'dcr:SubProcess') && element.businessObject['multi-instance']);
}

function nonExistingOrLabel(element) {
  return !element || isLabel(element);
}

function canConnect(source, target) {
  if (nonExistingOrLabel(source) || nonExistingOrLabel(target)) {
    return null;
  }
  if (canConnectLink(source, target)) {
    if (source === target && is(source, 'dcr:SubProcess')) {
      return false;
    } else if (is(target, 'dcr:SubProcess') && target.businessObject['multi-instance'] && !isAny(source, ['dcr:Event', 'dcr:Nesting'])) {
      return false;
    } else if (is(target, 'dcr:SubProcess') && target.businessObject['multi-instance']) {
      return { type: 'dcr:Relation', attrs: { type: 'spawn' } };
    } else if (source === target) {
      return { type: 'dcr:Relation', attrs: { type: 'exclude' } };
    } else {
      return { type: 'dcr:Relation', attrs: { type: 'condition' } };
    }
  }
  return false;
}

function canConnectLink(source, target) {
  return (
    isAny(source, ['dcr:Event', 'dcr:Nesting', 'dcr:SubProcess']) &&
    isAny(target, ['dcr:Event', 'dcr:Nesting', 'dcr:SubProcess']) &&
    !isParent(source, target) &&
    !(is(source, 'dcr:SubProcess') && source.businessObject['multi-instance'])
    // && (source !== target || is(source, 'dcr:Event')) tkl
  );
}

/**
 * Can an element be dropped into the target element
 *
 * @return {Boolean}
 */
function canDrop(element, target) {
  // can move labels
  if (isLabel(element) || isGroup(element)) {
    return true;
  }

  // allow events and nestings to be dropped in nestings
  if (
    (isAny(element, ['dcr:Event', 'dcr:Nesting', 'dcr:Relation']) || (is(element, 'dcr:SubProcess') && !element.businessObject['multi-instance'])) &&
    isAny(target, ['dcr:Nesting', 'dcr:SubProcess']) &&
    !(is(element, 'dcr:Nesting') && is(target, 'dcr:SubProcess') && !target.businessObject['multi-instance'])
  ) {
    return true;
  }

  // drop board elements onto boards
  return is(element, 'dcr:BoardElement') && is(target, 'dcr:DcrGraph');
}

function canReplace(elements, target) {
  return target;
}

function canAttach(elements, target) {
  if (!Array.isArray(elements)) {
    elements = [elements];
  }

  // only (re-)attach one element at a time
  if (elements.length !== 1) {
    return false;
  }

  var element = elements[0];

  // do not attach labels
  if (isLabel(element)) {
    return false;
  }

  if (is(target, 'dcr:BoardElement')) {
    return false;
  }

  return 'attach';
}

function canMove(elements, target) {
  // allow default move check to start move operation
  if (!target) {
    return true;
  }

  return elements.every(function (element) {
    return canDrop(element, target);
  });
}

function canCreate(shape, target, source, position) {
  if (!target) {
    return false;
  }

  if (isLabel(shape) || isGroup(shape)) {
    return true;
  }

  if (isSame(source, target)) {
    return false;
  }

  // ensure we do not drop the element
  // into source
  if (source && isParent(source, target)) {
    return false;
  }

  return canDrop(shape, target, position);
}

function canResize(shape, newBounds) {
  //prevent the resize of dcr events / objects => tlk
  if (isAny(shape, ['dcr:Nesting', 'dcr:SubProcess'])) {
    //if (isAny(shape, [ 'dcr:Event', 'dcr:TextBox' ])) {
    return !newBounds || (newBounds.width >= 50 && newBounds.height >= 50);
  }
  return false;
}

function canCopy(elements, element) {
  return true;
}

function isLinkAllowed(element, type) {
  if (type === 'exclude' && isSame(element.source, element.target) && !is(element.target, 'dcr:Event')) {
    return false;
  }

  if (type === 'spawn' && (!is(element.target, 'dcr:SubProcess') || !element.target.businessObject['multi-instance'] || !isAny(element.source, ['dcr:Event', 'dcr:Nesting']))) {
    return false;
  }

  if (type === 'setValue' && !is(element.target, 'dcr:Event')) {
    return false;
  }

  if (is(element.target, 'dcr:SubProcess') && element.target.businessObject['multi-instance'] && type !== 'spawn') {
    return false;
  }

  if (isSame(element.source, element.target) && !['exclude', 'noresponse', 'setValue'].includes(type)) {
    return false;
  }

  return true;
}

function canHaveLabel(element) {
  return !isAny(element, ['dcr:Relation']);
}
