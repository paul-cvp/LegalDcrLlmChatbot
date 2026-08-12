import inherits from 'inherits';

import { is } from '../../util/ModelUtil';

/**
 * @class
 * @implements {PopupMenuProvider}
 */
export default function DCRPopupProvider(
  popupMenu, modeling, moddle,
  dcrReplace, rules, translate, dcrRules
) {

  this._popupMenu = popupMenu;
  this._modeling = modeling;
  this._moddle = moddle;
  this._dcrReplace = dcrReplace;
  this._rules = rules;
  this._translate = translate;
  this._dcrRules = dcrRules;

  this.register();
}


DCRPopupProvider.$inject = [

  'popupMenu',
  'modeling',
  'moddle',
  'dcrReplace',
  'rules',
  'translate',
  'dcrRules'
];

DCRPopupProvider.prototype.getHeaderEntries = function (element) {
  const isPending = element.businessObject.get('pending') || false;
  const isIncluded = element.businessObject.get('included') || false;
  const isExecuted = element.businessObject.get('executed') || false;
  const isMultiInstance = element.businessObject.get('multi-instance') || false;

  let buttons = [];

  if (!is(element, 'dcr:SubProcess') || !isMultiInstance) {
    buttons.push(
      {
        id: 'toggle-pending-state',
        className: 'od-text-box-pending',
        title: 'Pending State',
        active: isPending,
        action: (event, entry) => {
          this._modeling.updateProperties(element, {
            pending: !isPending
          });
        },
        loopType: 'Pending',
      },
      {
        id: 'toggle-included-state',
        className: 'od-text-box-included',
        title: 'Included State',
        active: isIncluded,
        action: (event, entry) => {
          this._modeling.updateProperties(element, {
            included: !isIncluded
          });
        },
        loopType: 'Included',
      },
      {
        id: 'toggle-executed-state',
        className: 'od-text-box-executed',
        title: 'Executed State',
        active: isExecuted,
        action: (event, entry) => {
          this._modeling.updateProperties(element, {
            executed: !isExecuted
          });
        },
        loopType: 'Executed',
      }
    );
  }

  return buttons;
};

DCRPopupProvider.prototype.getEntries = function (element) {
  const isMultiInstance = element.businessObject.get('multi-instance') || false;
  const containsNesting = element.children.some(child => is(child, 'dcr:Nesting'));
  if (is(element, 'dcr:SubProcess') && (isMultiInstance || is(element.parent, 'dcr:DcrGraph')) && (!isMultiInstance || !containsNesting)) {
    return [{
      id: 'toggle-multi-instance-state',
      label: `Change to ${isMultiInstance ? 'Single' : 'Multi'}-Instance SubProcess`,
      action: (event, entry) => {
        this._modeling.updateProperties(element, {
          'multi-instance': !isMultiInstance
        });
      }
    }];
  } else {
    return [];
  }
};

DCRPopupProvider.prototype._createMenuEntry = function (definition, element, action) {
  var translate = this._translate;
  var replaceElement = this._postitReplace.replaceElement;

  var replaceAction = function () {
    return replaceElement(element, definition.target);
  };

  action = action || replaceAction;

  var menuEntry = {
    label: translate(definition.label),
    className: definition.className,
    id: definition.actionName,
    action: action
  };

  return menuEntry;
};

DCRPopupProvider.prototype._createMenuEntry = function (definition, element, action) {
  var translate = this._translate;
  var replaceElement = this._dcrReplace.replaceElement;

};

DCRPopupProvider.prototype.register = function () {
  this._popupMenu.registerProvider('dcr-object-popup', this);
}; 