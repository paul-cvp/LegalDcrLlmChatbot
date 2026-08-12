import PreviewSupportModule from 'diagram-js/lib/features/preview-support';

import DcrReplacePreview from './DcrReplacePreview';

export default {
  __depends__: [
    PreviewSupportModule
  ],
  __init__: [ 'dcrReplacePreview' ],
  dcrReplacePreview: [ 'type', DcrReplacePreview ]
};
