import CopyPasteModule from '../copy-paste';
import ReplaceModule from 'diagram-js/lib/features/replace';
import SelectionModule from 'diagram-js/lib/features/selection';

import DcrReplace from './DcrReplace';

export default {
  __depends__: [
    CopyPasteModule,
    ReplaceModule,
    SelectionModule
  ],
  dcrReplace: [ 'type', DcrReplace ]
};
