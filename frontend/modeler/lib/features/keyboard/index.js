import KeyboardModule from 'diagram-js/lib/features/keyboard';

import DCRKeyboardBindings from './DCRKeyboardBindings';

export default {
  __depends__: [
    KeyboardModule
  ],
  __init__: [ 'keyboardBindings' ],
  keyboardBindings: [ 'type', DCRKeyboardBindings ]
};
