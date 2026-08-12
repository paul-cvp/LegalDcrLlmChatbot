import Modeler from '/lib/Modeler';
import Viewer from '/lib/Viewer';

import { test, it, expect, describe, beforeEach } from 'vitest';

import {
  insertCSS
} from '../helper';

import simpleXML from '../fixtures/simple.xml?raw';
import complexXML from '../fixtures/complex.xml?raw';
import emptyXML from '../fixtures/empty.xml?raw';

describe('Modeler', () => {

  let container;
  let modeler;

  beforeEach(() => {
    container = document.createElement('div');
  });

  async function createModeler(xml) {
    modeler = new Modeler({
      container: container,
      keyboard: {
        bindTo: document
      }
    });

    try {
      const result = await modeler.importXML(xml);
      return { error: null, warnings: result.warnings, modeler: modeler };
    } catch (err) {
      return { error: err, warnings: err.warnings, modeler: modeler };
    }
  }


  it('should import simple board', async () => {
    const result = await createModeler(simpleXML);
    expect(result.error).toBeNull();
  });


  it('should import complex', async () => {
    const result = await createModeler(complexXML);
    expect(result.error).toBeNull();
  });


  // it('should not import empty definitions', async () => {
  //   await expect(async () => {
  //     const result = await createModeler(emptyXML);
  //     let modeler = result.modeler;
  //     await modeler.importXML(emptyXML);
  //   }).rejects.toThrowError('no rootBoard to display');
  // });


  // it('should re-import simple board', async () => {
  //   const result = await createModeler(simpleXML);
  //   const modeler = result.modeler;
  //   const importResult = await modeler.importXML(simpleXML);
  //   expect(importResult.warnings).toHaveLength(0);
  // });


  describe('editor actions support', async () => {
    it('should ship all actions', async () => {
      const expectedActions = [
        'undo',
        'redo',
        'copy',
        'paste',
        'stepZoom',
        'zoom',
        'removeSelection',
        'moveCanvas',
        'moveSelection',
        'selectElements',
        'spaceTool',
        'lassoTool',
        'handTool',
        'globalConnectTool',
        'alignElements',
        'directEditing',
        'moveToOrigin'
      ];

      const modeler = new Modeler();
      const editorActions = modeler.get('editorActions');
      const actualActions = editorActions.getActions();
      expect(actualActions).toEqual(expectedActions);
    });

  });


  // describe('configuration', async () => {
  //   it('should configure Canvas', async () => {
  //     const modeler = new Modeler({
  //       container,
  //       canvas: {
  //         deferUpdate: true
  //       }
  //     });

  //     await modeler.importXML(simpleXML);
  //     const canvasConfig = modeler.get('config.canvas');
  //     expect(canvasConfig.deferUpdate).toBeTruthy();
  //   });
  // });


  it('should handle errors', async () => {
    await expect(async () => {
      const xml = 'invalid stuff';
      const modeler = new Modeler({ container });
      await modeler.importXML(xml);
    }).rejects.toThrowError();
  });


  it('should create new diagram', async () => {
    const modeler = new Modeler({ container });
    expect(modeler.createDiagram()).toBeDefined();
  });


  // describe('dependency injection', async () => {
  //   it('should provide self as <odm>', async () => {
  //     const result = await createModeler(simpleXML);
  //     const modeler = result.modeler;
  //     const err = result.error;

  //     if (err) {
  //       throw err;
  //     }

  //     expect(modeler.get('odm')).toEqual(modeler);
  //   });


  //   it('should inject mandatory modules', async () => {
  //     const result = await createModeler(simpleXML);
  //     const modeler = result.modeler;
  //     const err = result.error;

  //     if (err) {
  //       throw err;
  //     }

  //     expect(modeler.get('alignElements')).toBeDefined();
  //     expect(modeler.get('autoScroll')).toBeDefined();
  //     expect(modeler.get('odCopyPaste')).toBeDefined();
  //     expect(modeler.get('contextPad')).toBeDefined();
  //     expect(modeler.get('copyPaste')).toBeDefined();
  //     expect(modeler.get('alignElements')).toBeDefined();
  //     expect(modeler.get('editorActions')).toBeDefined();
  //     expect(modeler.get('keyboard')).toBeDefined();
  //     expect(modeler.get('keyboardMoveSelection')).toBeDefined();
  //     expect(modeler.get('labelEditingProvider')).toBeDefined();
  //     expect(modeler.get('modeling')).toBeDefined();
  //     expect(modeler.get('move')).toBeDefined();
  //     expect(modeler.get('paletteProvider')).toBeDefined();
  //     expect(modeler.get('resize')).toBeDefined();
  //     expect(modeler.get('snapping')).toBeDefined();
  //   });
  // });


  it('should expose Viewer', async () => {
    expect(Modeler.Viewer).toEqual(Viewer);
  });
});
