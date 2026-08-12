import EditorActionsModule from 'diagram-js/lib/features/editor-actions';

import DCREditorActions from './DCREditorActions';

export default {
  __depends__: [
    EditorActionsModule
  ],
  editorActions: [ 'type', DCREditorActions ]
};
