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

DCRPopupProvider.prototype.getHeaderEntries = function(element) {
  
  const isPending = element.businessObject.get('pending') || false;
  const isIncluded = element.businessObject.get('included') || element.businessObject.get('included') === undefined ? true : false;
  const isExecuted = element.businessObject.get('executed') || false;

  let self = this;
  
  let buttons = [
    {
      id: 'toggle-pending-state',
      className: 'od-text-box-pending', 
      title: 'Pending State',
      active: isPending,
      action: (event, entry) => {
        self._modeling.updateProperties(element, {
          pending: !isPending
        });
        element.children.forEach(child => {
          self._modeling.updateProperties(child, {
            pending: !isPending
          });
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
        self._modeling.updateProperties(element, {
          included: !isIncluded
        });
        element.children.forEach(child => {
          self._modeling.updateProperties(child, {
            included: !isIncluded
          });
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
        self._modeling.updateProperties(element, {
          executed: !isExecuted
        });
        element.children.forEach(child => {
          self._modeling.updateProperties(child, {
            executed: !isExecuted
          });
        });
      },
      loopType: 'Executed',
    }
  ];

  return buttons;
};

DCRPopupProvider.prototype.getEntries = function(element) {
  return [];
};

DCRPopupProvider.prototype._createMenuEntry = function(definition, element, action) {
  var translate = this._translate;
  var replaceElement = this._postitReplace.replaceElement;

  var replaceAction = function() {
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

DCRPopupProvider.prototype._createMenuEntry = function(definition, element, action) {
  var translate = this._translate;
  var replaceElement = this._dcrReplace.replaceElement;

};

DCRPopupProvider.prototype.register = function() {
  this._popupMenu.registerProvider('dcr-nesting-popup', this);
}; 