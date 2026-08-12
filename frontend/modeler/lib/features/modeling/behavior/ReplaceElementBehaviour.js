import inherits from 'inherits-browser';

import { forEach, reduce } from 'min-dash';

import CommandInterceptor from 'diagram-js/lib/command/CommandInterceptor';

/**
 * DCR-specific replace behavior
 */

export default function replaceElementBehaviour(
  dcrReplace,
  dcrRules,
  elemnentRegistry,
  injector,
  modeling,
  selection
) {
  injector.invoke(CommandInterceptor, this);

  this._dcrReplace = dcrReplace;
  this._elementRegistry = elementRegistry;
  this._selection = selection;

  // replace elements on create, e.g. during copy-paste
  this.postExecuted(['elements.create'], 500, function (event) {
    var context = event.context,
      target = context.parent,
      elements = context.elements;

    var elementReplacements = reduce(elements, function (replacements, element) {
      var canReplace = dcrRules.canReplace([element], element.host || element.parent || target);

      return canReplace ? replacements.concat(canReplace.replacements) : replacements;
    }, []);

    if (elementReplacements.length) {
      this.replaceElements(elements, elementReplacements);
    }
  }, this);

  
  // replace elements on move
  this.postExecuted([ 'elements.move' ], 500, function(event) {
    var context = event.context,
        target = context.newParent,
        newHost = context.newHost,
        elements = [];

    forEach(context.closure.topLevel, function(topLevelElements) {
      
        elements = elements.concat(topLevelElements);
      
    });

    // set target to host if attaching
    if (elements.length === 1 && newHost) {
      target = newHost;
    }

    var canReplace = dcrRules.canReplace(elements, target);

    if (canReplace) {
      this.replaceElements(elements, canReplace.replacements, newHost);
    }
  }, this);


  
  // update attachments on host replace
  this.postExecute([ 'shape.replace' ], 1500, function(e) {
    var context = e.context,
        oldShape = context.oldShape,
        newShape = context.newShape,
        attachers = oldShape.attachers,
        canReplace;

    if (attachers && attachers.length) {
      canReplace = dcrRules.canReplace(attachers, newShape);

      this.replaceElements(attachers, canReplace.replacements);
    }

  }, this);


  // keep ID on shape replace
  this.postExecuted([ 'shape.replace' ], 1500, function(e) {
    var context = e.context,
        oldShape = context.oldShape,
        newShape = context.newShape;

    modeling.unclaimId(oldShape.businessObject.id, oldShape.businessObject);
    modeling.updateProperties(newShape, { id: oldShape.id });
  });



}


inherits(replaceElementBehaviour, CommandInterceptor);

replaceElementBehaviour.prototype.replaceElements = function(elements, newElements) {
  var elementRegistry = this._elementRegistry,
      dcrReplace = this._dcrReplace,
      selection = this._selection;

  forEach(newElements, function(replacement) {
    var newElement = {
      type: replacement.newElementType
    };

    var oldElement = elementRegistry.get(replacement.oldElementId);

    var idx = elements.indexOf(oldElement);

    elements[idx] = dcrReplace.replaceElement(oldElement, newElement, { select: false });
  });

  if (newElements) {
    selection.select(elements);
  }
};

replaceElementBehaviour.$inject = [
  'dcrReplace',
  'dcrRules',
  'elementRegistry',
  'injector',
  'modeling',
  'selection'
];
