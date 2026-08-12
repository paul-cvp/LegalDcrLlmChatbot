import CopyPasteModule from 'diagram-js/lib/features/copy-paste';

import DcrCopyPaste from './DCRCopyPaste';
import ModdleCopy from './ModdleCopy';

export default {
  __depends__: [
    CopyPasteModule
  ],
  __init__: [ 'odCopyPaste', 'moddleCopy' ],
  odCopyPaste: [ 'type', DcrCopyPaste ],
  moddleCopy: [ 'type', ModdleCopy ]
};
