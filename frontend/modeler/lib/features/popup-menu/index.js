import PopupMenuModule from 'diagram-js/lib/features/popup-menu';
import ReplaceModule from '../replace';


import SubProcessPopupProvide from './SubProcessPopupProvider';
import NestingPopupProvider from './NestingPopupProvider';
import RelationPopupProvider from './RelationPopupProvider';

export default {
  __depends__: [
    PopupMenuModule,
    ReplaceModule
    
  ],
  __init__: [ 'subProcessPopupProvide', 'relationPopupProvider', 'nestingPopupProvider' ], 
  
  subProcessPopupProvide: ['type', SubProcessPopupProvide],
  nestingPopupProvider: ['type', NestingPopupProvider],
  relationPopupProvider: ['type', RelationPopupProvider],
};