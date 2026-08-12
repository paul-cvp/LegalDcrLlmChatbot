import DCRModeler from "modeler";

import emptyBoardXML from "../resources/emptyBoard";
import {useEffect, useEffectEvent, useState} from "react";

import {saveAs} from "file-saver";
import {StateEnum, type DCRGraphEntry, type StateProps} from "../App";
import FileUpload from "../utilComponents/FileUpload";
import ModalMenu, {type ModalMenuElement} from "../utilComponents/ModalMenu";

import {
    BiAnalyse,
    BiCog,
    BiHome,
    BiLeftArrowCircle,
    BiPlus,
    BiPlayCircle,
    BiSave,
    BiSolidDashboard,
    BiUser,
} from "react-icons/bi";

import Examples from "./Examples";
import {toast} from "react-toastify";
import TopRightIcons from "../utilComponents/TopRightIcons";
import {useHotkeys} from "react-hotkeys-hook";
import FullScreenIcon from "../utilComponents/FullScreenIcon";
import StyledFileUpload from "../utilComponents/StyledFileUpload";
import Loading from "../utilComponents/Loading";
import {type DCRGraph, layoutGraph, moddleToDCR, nestDCR, type Nestings,} from "dcr-engine";
import GraphNameInput from "../utilComponents/GraphNameInput";
import styled from "styled-components";
import {ColoredRelationsSetting, MarkerNotationSetting,} from "./GlobalModalMenuElements";
import ReactiveModeler, {type ActivityQuestionDraft} from "./ReactiveModeler";
import TestDrivenModeling from "./TestDrivenModeling";
import {useBPMN} from '../utilComponents/useBPMN';
import {BsStars} from "react-icons/bs";
import GraphMetadataModal from "./GraphMetadataModal.tsx";
import {listToolCalls, type ToolCallOption} from "../api/toolCalls.ts";
import {generateActivityQuestion} from "../api/activityQuestions.ts";


const GraphMetadataButton = styled(BiCog)<{ $open: boolean }>`
    ${(props) => props.$open ? `
        background-color: black !important;
        color: white;
    ` : ""}
`;

const initGraphName = "DCR-JS Graph";

const ModelerShell = styled.div<{ $embedded: boolean }>`
    position: relative;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;

    & > #canvas {
        width: 100%;
        height: 100%;
    }
`;

interface ModelerStateProps extends StateProps {
    embedded?: boolean;
    initialGraph?: DCRGraphEntry;
}

const ModelerState = ({
                          setState,
                          savedGraphs,
                          currentGraph,
                          draftGraph,
                          openDraftGraph,
                          pickGraph,
                          saveGraph: commitSaveGraph,
                          coloredRelations,
                          changeColoredRelations,
                          markerNotation,
                          changeMarkerNotation,
                          embedded = false,
                          initialGraph,
                      }: ModelerStateProps) => {
    const [examplesOpen, setExamplesOpen] = useState(false);
    const [examplesData, setExamplesData] = useState<Array<string>>([]);
    const [tdmOpen] = useState(false);
    const [graphMetadataOpen, setGraphMetadataOpen] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);

    const [loading, setLoading] = useState(false);
    const [toolCalls, setToolCalls] = useState<ToolCallOption[] | null>(null);

    // const modelerRef = useRef<DCRModeler | null>(null);
    const [modeler, setModeler] = useState<DCRModeler | null>(null);

    useEffect(() => {
        listToolCalls()
            .then(setToolCalls)
            .catch((error: unknown) => console.error("Unable to load tool calls", error));
    }, []);

    const [graphName, setGraphName] = useState<string>(
        initialGraph?.name ?? draftGraph?.name ?? currentGraph?.name ?? initGraphName,
    );

    function warnIfInvalidGuards(): boolean {
        if (!modeler) return false;
        const issues: string[] = modeler.validateGuards();
        issues.forEach((msg: string) => toast.warning(msg));
        return issues.length > 0;
    }

    async function switchToSimulation() {
        if (!modeler || warnIfInvalidGuards()) return;
        try {
            setLoading(true);
            const {xml} = await modeler.saveXML({format: true});
            openDraftGraph(graphName, xml, StateEnum.Simulator, true);
        } catch (error) {
            console.error(error);
            toast.error("Unable to open this graph in Simulation.");
        } finally {
            setLoading(false);
        }
    }

    async function generateMetadataQuestion(activity: ActivityQuestionDraft) {
        if (!modeler) throw new Error("The process modeler is unavailable.");
        const {xml} = await modeler.saveXML({format: true});
        return generateActivityQuestion({
            graphXml: xml,
            eventId: activity.id,
            label: activity.label,
            role: activity.role,
            description: activity.description,
        });
    }

    async function persistGraph(name: string, createNew = false) {
        if (!modeler) {
            return;
        }

        if (warnIfInvalidGuards()) return false;
        let saved = false;

        try {
            setLoading(true);
            const data = await modeler.saveXML({format: true});
            if (await commitSaveGraph(name, data.xml, createNew, currentGraph?.name)) {
                setGraphName(name.trim());
                toast.success("Graph saved!");
                saved = true;
            }
        } catch {
            toast.error("Failed to save graph...");
        } finally {
            setLoading(false);
        }

        return saved;
    }

    async function saveGraph() {
        return persistGraph(graphName);
    }

    async function saveGraphAs() {
        const name = window.prompt("Name for the new DCR graph:", `${graphName} Copy`);
        if (name === null) return false;
        return persistGraph(name, true);
    }

    useHotkeys("ctrl+s", saveGraph, {preventDefault: true});

    useEffect(() => {
        // Fetch examples
        fetch("/dcr-js/examples/generated_examples.txt")
            .then((response) => {
                if (!response.ok) {
                    throw new Error(
                        "Failed to fetch examples status code: " + response.status,
                    );
                }
                return response.text();
            })
            .then((data) => {
                let files = data.split("\n");
                files.pop(); // Remove last empty line
                files = files.map((name) => name.split(".").slice(0, -1).join(".")); // Shave file extension off
                setExamplesData(files);
            });
    }, []);


    function open(
        data: string,
        parse: ((xml: string) => Promise<void>) | undefined,
        importFn?: string,
    ) {
        const importName = importFn?.slice(0, -4);

        if (parse) {
            parse(data)
                .then(() => {
                    setGraphName(importName ? importName : initGraphName);
                    warnIfInvalidGuards();
                })
                .catch((e) => {
                    console.log(e);
                    toast.error("Unable to parse XML...");
                });
        }
    }


    async function saveAsXML() {
        if (!modeler) {
            return;
        }

        if (warnIfInvalidGuards()) return;
        const data = await modeler.saveXML({format: true});
        const blob = new Blob([data.xml]);

        saveAs(blob, `${graphName}.xml`);
    }

    async function saveAsDCRXML() {
        if (!modeler) {
            return;
        }

        if (warnIfInvalidGuards()) return;
        const data = await modeler.saveDCRXML();
        const blob = new Blob([data.xml]);

        saveAs(blob, `${graphName}.xml`);
    }

    async function saveAsSvg() {
        if (!modeler) {
            return;
        }

        const data = await modeler.saveSVG();
        const blob = new Blob([data.svg]);

        saveAs(blob, `${graphName}.svg`);
    }

    function savedGraphElements(): Array<ModalMenuElement> {
        if (savedGraphs.size === 0) {
            return [];
        }

        return [
            {
                text: "Saved Graphs:",
                elements: [...savedGraphs.values()].map(({name, graph}) => {
                    return {
                        icon: <BiLeftArrowCircle/>,
                        text: name,
                        onClick: () => {
                            open(graph, modeler?.importXML, name + ".xml");
                            pickGraph(name);
                            setMenuOpen(false);
                        },
                    };
                }),
            },
        ];
    }

    async function openTextWorkspace(destination: StateEnum, label: string) {
        setMenuOpen(false);
        const saved = await saveGraph();
        if (!saved && !window.confirm(`The graph was not saved. Open ${label} and discard these changes?`)) {
            return;
        }
        pickGraph(null);
        setState(destination);
    }

    const menuElements: Array<ModalMenuElement> = [
        {
            icon: <BiPlus/>,
            text: "New Diagram",
            onClick: () => {
                open(emptyBoardXML, modeler?.importXML);
                pickGraph(null);
                setMenuOpen(false);
            },
        },
        {
            icon: <BiSave/>,
            text: "Save Graph",
            onClick: () => {
                saveGraph();
                setMenuOpen(false);
            },
        },
        {
            icon: <BiSave/>,
            text: "Save Graph As",
            onClick: () => {
                saveGraphAs();
                setMenuOpen(false);
            },
        },
        ...(!embedded ? [{
            icon: <BsStars/>,
            text: "From Text",
            onClick: () => openTextWorkspace(StateEnum.FromText, "From Text"),
        }, {
            icon: <BiUser/>,
            text: "Citizen Information",
            onClick: () => openTextWorkspace(StateEnum.CitizenInformation, "Citizen Information"),
        }] : []),
        {
            text: "Open",
            elements: [
                {
                    customElement: (
                        <StyledFileUpload>
                            <FileUpload
                                accept="text/xml"
                                fileCallback={(name, contents) => {
                                    open(contents, modeler?.importXML, name);
                                    pickGraph(null);
                                    setMenuOpen(false);
                                }}
                            >
                                <div/>
                                <>Open Editor XML</>
                            </FileUpload>
                        </StyledFileUpload>
                    ),
                },
                {
                    customElement: (
                        <StyledFileUpload>
                            <FileUpload
                                accept="text/xml"
                                fileCallback={(name, contents) => {
                                    open(contents, modeler?.importDCRPortalXML, name);
                                    pickGraph(null);
                                    setMenuOpen(false);
                                }}
                            >
                                <div/>
                                <>Open DCR Solution XML</>
                            </FileUpload>
                        </StyledFileUpload>
                    ),
                },
                {
                    customElement: (
                        <StyledFileUpload>
                            <FileUpload accept=".bpmn,.xml" fileCallback={(name, contents) => {
                                convertBpmnToDcr(contents, name);
                                pickGraph(null);
                                setMenuOpen(false);
                            }}>
                                <div/>
                                <>Open BPMN 2.0 XML</>
                            </FileUpload>
                        </StyledFileUpload>
                    ),
                },
            ],
        },
        {
            text: "Download",
            elements: [
                {
                    icon: <div/>,
                    text: "Download Editor XML",
                    onClick: () => {
                        saveAsXML();
                        setMenuOpen(false);
                    },
                },
                {
                    icon: <div/>,
                    text: "Download DCR Solutions XML",
                    onClick: () => {
                        saveAsDCRXML();
                        setMenuOpen(false);
                    },
                },
                {
                    icon: <div/>,
                    text: "Download SVG",
                    onClick: () => {
                        saveAsSvg();
                        setMenuOpen(false);
                    },
                },
            ],
        },
        {
            icon: <BiSolidDashboard/>,
            text: "Examples",
            onClick: () => {
                setMenuOpen(false);
                setExamplesOpen(true);
            },
        },
        ...savedGraphElements(),
    ];

    const bottomElements: Array<ModalMenuElement> = [
        {
            customElement: (
                <ColoredRelationsSetting
                    coloredRelations={coloredRelations}
                    changeColoredRelations={changeColoredRelations}
                />
            ),
        },
        {
            customElement: (
                <MarkerNotationSetting
                    markerNotation={markerNotation}
                    changeMarkerNotation={changeMarkerNotation}
                />
            ),
        },
    ];

    const layout = () => {
        if (!modeler) return;
        const elementRegistry = modeler.getElementRegistry();
        const events = Object.values(elementRegistry._elements).filter(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (element: any) => element.element.id.includes("Event"),
        );
        const uniqueActivities = new Set(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            events.map((element: any) => element.element.businessObject.label),
        );
        if (events.length !== uniqueActivities.size || uniqueActivities.has("")) {
            toast.warning(
                "Graph layout not supported for empty or duplicate activity names...",
            );
            return;
        }
        if (
            Object.keys(elementRegistry._elements).find(
                (element) =>
                    element.includes("SubProcess") ||
                    elementRegistry._elements[element].element.businessObject.role,
            )
        ) {
            toast.warning("Graph layout not supported for subprocesses and roles...");
            return;
        }
        if (
            confirm(
                "This will overwrite your current layout, do you wish to continue?",
            )
        ) {
            try {
                const nest = confirm("Do you wish to nest?");
                const graph = moddleToDCR(elementRegistry, true);
                const nestings = nestDCR(graph);
                const params: [DCRGraph, Nestings | undefined] = nest
                    ? [nestings.nestedGraph, nestings]
                    : [graph, undefined];
                layoutGraph(...params)
                    .then((xml) => {
                        modeler
                            ?.importXML(xml)
                            .catch((e) => {
                                console.log(e);
                                toast.error("Invalid xml...");
                            })
                            .finally(() => {
                                setLoading(false);
                            });
                    })
                    .catch((e) => {
                        console.log(e);
                        setLoading(false);
                        toast.error("Unable to layout graph...");
                    });
            } catch {
                toast.error("Something went wrong...");
            }
        }
    };

    const autoLayout = () => {
        if (!modeler) return;
        const elementRegistry = modeler.getElementRegistry();
        const events = Object.values(elementRegistry._elements).filter(
            (element: any) => element.element.type === "dcr:Event"
        );
        const uniqueActivities = new Set(
            events.map((element: any) => element.element.businessObject.label)
        );
        if (events.length !== uniqueActivities.size || uniqueActivities.has("")) {
            return;
        }
        if (
            Object.keys(elementRegistry._elements).find(
                (element) =>
                    element.includes("SubProcess") ||
                    elementRegistry._elements[element].element.businessObject.role
            )
        ) {
            return;
        }

        try {
            setLoading(true);
            const graph = moddleToDCR(elementRegistry, true);
            const params: [DCRGraph, undefined] = [graph, undefined];
            layoutGraph(...params)
                .then((xml) => {
                    modeler
                        ?.importXML(xml)
                        .catch((e) => {
                            console.log(e);
                        })
                        .finally(() => {
                            setLoading(false);
                        });
                })
                .catch((e) => {
                    console.log(e);
                    setLoading(false);
                });
        } catch (e) {
            setLoading(false);
        }
    };

    const {convertBpmnToDcr, loading: bpmnLoading} = useBPMN(modeler, setGraphName, setLoading, autoLayout);

    const onInitModeler = useEffectEvent((modeler: DCRModeler) => {
        modeler
            .importXML(initialGraph?.graph ?? draftGraph?.graph ?? currentGraph?.graph ?? emptyBoardXML)
            .catch((e: Error) => {
                console.log(e);
                toast.error("Unable to import XML...");
            });
    });

    useEffect(() => {
        if (!modeler) {
            return;
        }

        onInitModeler(modeler);
    }, [modeler, initialGraph?.graph, draftGraph?.graph]);

    return (
        <ModelerShell $embedded={embedded}>
            <GraphNameInput
                $embedded={embedded}
                value={graphName}
                onChange={(e) => setGraphName(e.target.value)}
            />
            {(loading || bpmnLoading) && <Loading $embedded={embedded}/>}
            <ReactiveModeler
                modeler={modeler}
                setModeler={setModeler}
                coloredRelations={coloredRelations}
                markerNotation={markerNotation}
                isSimulating={false}
                disableControls={false}
                toolCalls={toolCalls}
                generateActivityQuestion={generateMetadataQuestion}
            />
            <TopRightIcons embedded={embedded}>
                <GraphMetadataButton
                    $open={graphMetadataOpen}
                    title="Edit DCR Graph metadata"
                    aria-label="Edit DCR Graph metadata"
                    data-testid="graph-metadata-icon"
                    onClick={() => {
                        if (modeler) setGraphMetadataOpen(true);
                    }}
                />
                <BiPlayCircle
                    title="Switch to Simulation"
                    aria-label="Switch to Simulation"
                    data-testid="simulation-mode-icon"
                    onClick={() => void switchToSimulation()}
                />
                {/* <HeatmapButton
                    onClick={() => {
                        if (!modeler) return;
                        const elementRegistry = modeler.getElementRegistry();

                        if (
                            !tdmOpen &&
                            Object.keys(elementRegistry._elements).find(
                                (element) =>
                                    element.includes("SubProcess") ||
                                    elementRegistry._elements[element].element.businessObject
                                        .role,
                            )
                        ) {
                            toast.warning(
                                "Test driven modeling not supported for subprocesses and roles...",
                            );
                            return;
                        }

                        if (
                            !tdmOpen &&
                            Object.keys(elementRegistry._elements).find((element) => {
                                const bo =
                                    elementRegistry._elements[element].element.businessObject;
                                return bo.guard || bo.time || bo.eventData;
                            })
                        ) {
                            toast.warning(
                                "Test driven modeling not supported for guards, time constraints, and variables...",
                            );
                            return;
                        }

                        setTdmOpen(!tdmOpen);
                    }}
                    $clicked={tdmOpen}
                    title="Open Test Driven Modeling Pane"
                    data-testid="heatmap-icon"
                /> */}
                <BiAnalyse
                    title="Layout Graph"
                    onClick={layout}
                    data-testid="analyse-icon"
                />
                <FullScreenIcon data-testid="fullscreen-icon"/>
                <BiHome
                    onClick={async () => {
                        const saved = await saveGraph();
                        if (
                            !saved &&
                            !window.confirm(
                                "Graph wasn't saved. Are you sure you wish to exit modeler?",
                            )
                        ) {
                            return;
                        }
                        setState(StateEnum.Home);
                    }}
                    data-testid="home-icon"
                />
                <ModalMenu
                    elements={menuElements}
                    bottomElements={bottomElements}
                    open={menuOpen}
                    setOpen={setMenuOpen}
                />
            </TopRightIcons>
            <TestDrivenModeling modeler={modeler} show={tdmOpen} embedded={embedded}/>
            {graphMetadataOpen && modeler && (
                <GraphMetadataModal
                    modeler={modeler}
                    onClose={() => setGraphMetadataOpen(false)}
                    embedded={embedded}
                />
            )}
            {examplesOpen && (
                <Examples
                    examplesData={examplesData}
                    openEditorXML={(xml) => open(xml, modeler?.importXML)}
                    openCustomXML={(xml) => open(xml, modeler?.importCustomXML)}
                    openDCRXML={(xml) => open(xml, modeler?.importDCRPortalXML)}
                    setExamplesOpen={setExamplesOpen}
                    setLoading={setLoading}
                />
            )}
        </ModelerShell>
    );
};

export default ModelerState;
