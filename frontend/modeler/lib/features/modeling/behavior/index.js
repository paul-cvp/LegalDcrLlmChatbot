import AdaptiveLabelPositioningBehavior from './AdaptiveLabelPositioningBehavior';
import AppendBehavior from './AppendBehavior';
import FixHoverBehavior from './FixHoverBehavior';
import ImportDockingFix from './ImportDockingFix';
import LabelBehavior from './LabelBehavior';
import UnclaimIdBehavior from './UnclaimIdBehavior';
import EmptyTextBoxBehavior from './EmptyTextBoxBehavior';
import replaceElementBehaviour from './ReplaceElementBehaviour';

export default {
  __init__: [
    'adaptiveLabelPositioningBehavior',
    'appendBehavior',
    'fixHoverBehavior',
    'importDockingFix',
    'labelBehavior',
    'unclaimIdBehavior',
    'emptyTextBoxBehavior',
    //'replaceElementBehaviour'
  ],
  adaptiveLabelPositioningBehavior: [ 'type', AdaptiveLabelPositioningBehavior ],
  appendBehavior: [ 'type', AppendBehavior ],
  fixHoverBehavior: [ 'type', FixHoverBehavior ],
  importDockingFix: [ 'type', ImportDockingFix ],
  labelBehavior: [ 'type', LabelBehavior ],
  unclaimIdBehavior: [ 'type', UnclaimIdBehavior ],
  emptyTextBoxBehavior: [ 'type', EmptyTextBoxBehavior ],
  //replaceElementBehaviour: [ 'type', replaceElementBehaviour]
};
