import inherits from 'inherits';

/**
 * @class
 * @implements {PopupMenuProvider}
 */
export default function DCRPopupProvider(
   popupMenu, modeling, moddle, 
   dcrReplace, rules, translate, dcrRules, guardsAndTimeProvider
) {

  this._popupMenu = popupMenu;
  this._modeling = modeling;
  this._moddle = moddle;
  this._dcrReplace = dcrReplace;
  this._rules = rules;
  this._translate = translate;
  this._dcrRules = dcrRules;
  this._guardsAndTimeProvider = guardsAndTimeProvider;

  this.register();
}


DCRPopupProvider.$inject = [

  'popupMenu',
  'modeling',
  'moddle',
  'dcrReplace',
  'rules',
  'translate',
  'dcrRules',
  'guardsAndTimeProvider'
];

DCRPopupProvider.prototype.getHeaderEntries = function(element) {
  return [];
};

DCRPopupProvider.prototype.getEntries = function(element) {
  let self = this;

  function changeType(flowType) {
    self._modeling.updateProperties(element, {
      type: flowType,
      time: ['condition', 'response'].includes(flowType)
        ? element.businessObject.get('time')
        : undefined,
      value: flowType === 'setValue'
        ? element.businessObject.get('value')
        : undefined
    });
  }
  
  const entries = [
    {
      id: 'toggle-condition-flow',
      //className: 'bpmn-icon-intermediate-event-none',
      label: 'Condition Relation',
      flowType: 'condition',
      action: (event, entry) => {
        changeType(entry.flowType);
      },
    },
    {
      id: 'toggle-response-flow',
      //className: 'bpmn-icon-intermediate-event-none',
      label: 'Response Relation',
      flowType: 'response',
      action: (event, entry) => {
        changeType(entry.flowType);
      },
    },
    {
      id: 'toggle-include-flow',
      //className: 'bpmn-icon-intermediate-event-none',
      label: 'Include Relation',
      flowType: 'include',
      action: (event, entry) => {
        changeType(entry.flowType);
      },
    },
    {
      id: 'toggle-exclude-flow',
      //className: 'bpmn-icon-intermediate-event-none',
      label: 'Exclude Relation',
      flowType: 'exclude',
      action: (event, entry) => {
        changeType(entry.flowType);
      },
    },
    {
      id: 'toggle-milestone-flow',
      //className: 'bpmn-icon-intermediate-event-none',
      label: 'Milestone Relation',
      flowType: 'milestone',
      action: (event, entry) => {
        changeType(entry.flowType);
      },
    },
    {
      id: 'toggle-noresponse-flow',
      label: 'No-response Relation',
      flowType: 'noresponse',
      action: (event, entry) => {
        changeType(entry.flowType);
      },
    },
    {
      id: 'toggle-setvalue-flow',
      label: 'Set-value Relation',
      flowType: 'setValue',
      action: () => {
        self._guardsAndTimeProvider.openRelationPanel(element, 'setValue');
      },
    },
    {
      id: 'toggle-spawn-flow',
      //className: 'bpmn-icon-intermediate-event-none',
      label: 'Spawn Relation',
      flowType: 'spawn',
      action: (event, entry) => {
        changeType(entry.flowType);
      },
    }
  ];

  return entries.filter(entry => self._dcrRules.isLinkAllowed(element, entry.flowType));
};


DCRPopupProvider.prototype.register = function() {
  this._popupMenu.registerProvider('dcr-link-popup', this);
};
