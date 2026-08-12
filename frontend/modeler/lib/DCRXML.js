import { assign } from 'min-dash';
import xml2js from 'xml2js';

function generateBoard() {
  return {
    dcrgraph: {
      specification: {
        resources: {
          events: {
            event: []
          },
          subProcesses: {
            subProcess: []
          },
          labels: {
            label: []
          },
          labelMappings: {
            labelMapping: []
          },
          variables: {
            variable: []
          },
          expressions: {
            expression: []
          },
          variableAccesses: {
            readAccessess: {
              readAccess: []
            },
            writeAccessess: {
              writeAccess: []
            }
          }
        },
        constraints: {
          conditions: {
            condition: []
          },
          responses: {
            response: []
          },
          coresponces: {
            coresponce: []
          },
          excludes: {
            exclude: []
          },
          includes: {
            include: []
          },
          milestones: {
            milestone: []
          },
          updates: {
            update: []
          },
          spawns: {
            spawn: []
          }
        }
      },
      runtime: {
        marking: {
          globalStore: {},
          executed: {
            event: []
          },
          included: {
            event: []
          },
          pendingResponses: {
            event: []
          }
        }
      }
    }
  };
}

function handleLabels(dcr, element) {
  const displayLabel = element.label;
  if (displayLabel && displayLabel.trim().length > 0) {
    if (!dcr.dcrgraph.specification.resources.labels.label.some(label => label.$.id === displayLabel)) {
      dcr.dcrgraph.specification.resources.labels.label.push({
        $: {
          id: displayLabel
        }
      });
    }

    dcr.dcrgraph.specification.resources.labelMappings.labelMapping.push({ $: { eventId: element.id, labelId: displayLabel } });
  }
}

function handleRoles(object, element) {
  if (element.role) {
    if (!object.custom) object.custom = {};
    assign(object.custom, {
      roles: {
        role: { _: element.role }
      }
    });
  }
}

function handleDimensions(object, element) {
  if (!object.custom) object.custom = {};
  assign(object.custom, {
    visualization: {
      location: {
        $: {
          xLoc: element.di.bounds.x,
          yLoc: element.di.bounds.y,
        }
      },
      size: {
        $: {
          width: element.di.bounds.width,
          height: element.di.bounds.height,
        }
      }
    }
  });
}

function handleStates(dcr, element) {
  if (element.included) {
    dcr.dcrgraph.runtime.marking.included.event.push({ $: { id: element.id } });
  }
  if (element.executed) {
    dcr.dcrgraph.runtime.marking.executed.event.push({ $: { id: element.id } });
  }
  if (element.pending) {
    dcr.dcrgraph.runtime.marking.pendingResponses.event.push({ $: { id: element.id } });
  }
}

function addEvent(dcr, parent, element, object) {
  if (element.priority !== undefined) object.$.priority = element.priority;
  handleLabels(dcr, element);
  handleRoles(object, element);
  handleStates(dcr, element);
  handleDimensions(object, element);
  parent.push(object);
}

function addNesting(dcr, parent, element, object) {
  assign(object.$, {
    type: 'nesting',
  });

  handleLabels(dcr, element);
  handleRoles(object, element);

  handleDimensions(object, element);

  object.event = [];

  parent.push(object);
  for (let child of element.boardElements || []) {
    addElement(dcr, object.event, child);
  }
}

function addSubProcess(dcr, parent, element, object) {
  if (element['multi-instance']) {
    assign(object.$, {
      name: element.label,
      multiInstance: element['multi-instance'],
    });


    handleDimensions(object, element);
    object.dcrgraph = generateBoard().dcrgraph;

    dcr.dcrgraph.specification.resources.subProcesses.subProcess.push(object);
    for (let child of element.boardElements || []) {
      addElement(object, object.dcrgraph.specification.resources.events.event, child);
    }
  } else {
    assign(object.$, {
      type: 'subprocess',
    });

    handleLabels(dcr, element);
    handleStates(dcr, element);
    handleDimensions(object, element);

    object.event = [];

    parent.push(object);
    for (let child of element.boardElements || []) {
      addElement(dcr, object.event, child);
    }
  }
}

function addLink(dcr, parent, element, object) {
  object = {
    $: {
      sourceId: element.sourceRef.id,
      targetId: element.targetRef.id,
    },
    custom: {
      waypoints: {
        waypoint: element.di.waypoint.map(point => ({ $: { x: point.x, y: point.y } }))
      },
      id: {
        $: {
          id: element.id,
        }
      }
    }
  };

  if (element.guard) object.$.guard = element.guard;
  if (element.time) object.$.time = element.time;
  if (element.value) object.$.value = element.value;
  if (element.forAll !== undefined) object.$.forAll = element.forAll;

  // Add the link to the correct constraint
  const relationTarget = element.type === 'noresponse'
    ? ['coresponces', 'coresponce']
    : element.type === 'setValue'
      ? ['updates', 'update']
      : [`${element.type}s`, element.type];
  dcr.dcrgraph.specification.constraints[relationTarget[0]][relationTarget[1]].push(object);
}

function addElement(dcr, parent, element) {
  let object = {
    $: {
      id: element.id,
    }
  };

  switch (element.$type) {
    case 'dcr:Event':
      addEvent(dcr, parent, element, object);
      break;
    case 'dcr:Nesting':
      addNesting(dcr, parent, element, object);
      break;
    case 'dcr:SubProcess':
      addSubProcess(dcr, parent, element, object);
      break;
    case 'dcr:Relation':
      addLink(dcr, parent, element, object);
      break;
    default:
      console.warn('unknown element type', element.$type);
      break;
  }
}

export default function asXML(options, definitions) {
  options = options || {};

  return new Promise((resolve, reject) => {
    if (!definitions) {
      var err = new Error('no definitions loaded');

      return reject(err);
    }

    let dcr = generateBoard();

    if (definitions.rootElements[0].boardElements) {
      for (let element of definitions.rootElements[0].boardElements) {
        addElement(dcr, dcr.dcrgraph.specification.resources.events.event, element);
      }
    }

    let builder = new xml2js.Builder();
    const xml = builder.buildObject(dcr).replace(
      /\b(guard|value)="([^"]*)"/g,
      (_, name, value) => `${name}="${value.replace(/>/g, '&gt;')}"`,
    );
    return resolve({ xml });
  });
};
