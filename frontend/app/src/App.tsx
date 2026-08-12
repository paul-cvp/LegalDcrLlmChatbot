import { useCallback, useEffect, useMemo, useState } from "react";
import ModelerState from "./components/ModelerState";
import HomeState from "./components/HomeState";
import SimulatorState from "./components/SimulatorState";
import ConformanceCheckingState from "./components/ConformanceCheckingState";
import type { EventLog, RoleTrace } from "dcr-engine";
import DiscoveryState from "./components/DiscoveryState";
import EventLogGenerationState from "./components/EventLogGenerationState";
import FromTextState from "./components/FromTextState";
import CitizenInformationState from "./components/CitizenInformationState";
import ChatState from "./components/ChatState";
import {
  type CitizenInformationSession,
  loadCitizenInformation,
  storeCitizenInformation,
} from "./components/citizenInformationStorage";
import {
  isColoredRelations,
  isMarkerNotation,
  type ColoredRelations,
  type MarkerNotation,
} from "./types";
import {
  createDCRGraph,
  deleteDCRGraph,
  listDCRGraphs,
  updateDCRGraph,
} from "./api/dcrGraphs";

export const StateEnum = {
  Modeler: "Modeler",
  Home: "Home",
  Simulator: "Simulator",
  Conformance: "Conformance",
  Discovery: "Discovery",
  EventLogGeneration: "EventLogGeneration",
  FromText: "FromText",
  CitizenInformation: "CitizenInformation",
  Chat: "Chat",
} as const;

export type StateEnum = (typeof StateEnum)[keyof typeof StateEnum];

export interface DCRGraphEntry {
  name: string;
  graph: string;
}

export interface EventLogEntry {
  name: string;
  log: EventLog<RoleTrace>;
}

export type ChatLaunchConfig =
  | { mode: "dcr-controller" }
  | { mode: "rag" }
  | { mode: "dcr"; graphName: string; graphXml: string };

export type DCRGraphRepository = Map<string, DCRGraphEntry>;

export type EventLogRepository = Map<string, EventLogEntry>;

export interface StateProps {
  setState: (state: StateEnum) => void;
  openChat: (configuration: ChatLaunchConfig) => void;
  savedGraphs: DCRGraphRepository;
  setSavedGraphs: React.Dispatch<React.SetStateAction<DCRGraphRepository>>;
  savedLogs: EventLogRepository;
  setSavedLogs: React.Dispatch<React.SetStateAction<EventLogRepository>>;
  currentGraph: DCRGraphEntry | null;
  draftGraph: DCRGraphEntry | null;
  openDraftGraph: (
    name: string,
    graph: string,
    destination?: StateEnum,
    preserveCurrent?: boolean,
  ) => void;
  setCurrentGraph: (graphName: string | null) => void;
  currentLog: EventLogEntry | null;
  setCurrentLog: (logName: string | null) => void;
  saveGraph: (
    name: string,
    graph: string,
    createNew?: boolean,
    graphToUpdate?: string,
  ) => Promise<boolean>;
  deleteGraph: (name: string) => Promise<boolean>;
  graphsLoading: boolean;
  graphsError: string | null;
  reloadGraphs: () => Promise<void>;
  saveLog: (name: string, log: EventLog<RoleTrace>) => boolean;
  pickGraph: (name?: string | null) => void;
  pickLog: (name?: string | null) => void;
  markerNotation: MarkerNotation;
  changeMarkerNotation: (value: unknown) => void;
  coloredRelations: ColoredRelations;
  changeColoredRelations: (value: unknown) => void;
}

const App = () => {
  const [state, setState] = useState<StateEnum>(StateEnum.Home);
  const [chatLaunch, setChatLaunch] = useState<ChatLaunchConfig | null>(null);
  const [citizenInformation, setCitizenInformationState] = useState(
    loadCitizenInformation,
  );

  const updateCitizenInformation = useCallback((changes: Partial<CitizenInformationSession>) => {
    setCitizenInformationState((current) => {
      const updated = { ...current, ...changes };
      storeCitizenInformation(updated);
      return updated;
    });
  }, []);

  const [markerNotation, setMarkerNotation] =
    useState<MarkerNotation>("HM2011");

  const [coloredRelations, setColoredRelations] =
    useState<ColoredRelations>(true);

  const [graphs, setGraphs] = useState<DCRGraphRepository>(new Map());
  const [graphsLoading, setGraphsLoading] = useState(true);
  const [graphsError, setGraphsError] = useState<string | null>(null);
  const [logs, setLogs] = useState<EventLogRepository>(new Map());

  const [currentGraphName, setCurrentGraphName] = useState<string | null>(null);
  const [draftGraph, setDraftGraph] = useState<DCRGraphEntry | null>(null);
  const [currentLogName, setCurrentLogName] = useState<string | null>(null);

  const currentGraph = useMemo(() => {
    if (currentGraphName === null) {
      return null;
    }

    return graphs.get(currentGraphName) ?? null;
  }, [graphs, currentGraphName]);

  const currentLog = useMemo(() => {
    if (currentLogName === null) {
      return null;
    }

    return logs.get(currentLogName) ?? null;
  }, [logs, currentLogName]);

  const reloadGraphs = useCallback(async () => {
    setGraphsLoading(true);
    setGraphsError(null);
    try {
      const resources = await listDCRGraphs();
      setGraphs(
        new Map(
          resources.map(({ name, xml }) => [name, { name, graph: xml }]),
        ),
      );
      setCurrentGraphName((current) =>
        current && resources.some(({ name }) => name === current)
          ? current
          : null,
      );
    } catch (error) {
      setGraphsError(
        error instanceof Error ? error.message : "Unable to load DCR graphs.",
      );
    } finally {
      setGraphsLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadGraphs();
  }, [reloadGraphs]);

  const saveGraph = useCallback(
    async (
      name: string,
      graph: string,
      createNew = false,
      graphToUpdate?: string,
    ) => {
      const normalizedName = name.trim();
      try {
        const isCurrentGraph =
          !createNew &&
          currentGraphName !== null &&
          (graphToUpdate !== undefined ||
            currentGraphName.toLocaleLowerCase() ===
              normalizedName.toLocaleLowerCase());
        const previousName = isCurrentGraph
          ? (graphToUpdate ?? currentGraphName)
          : null;
        const resource = isCurrentGraph
          ? await updateDCRGraph(previousName!, graph, normalizedName)
          : await createDCRGraph(normalizedName, graph);

        setGraphs((prev) => {
          const newMap = new Map(prev);
          if (previousName !== null && previousName !== resource.name) {
            newMap.delete(previousName);
          }
          newMap.set(resource.name, {
            name: resource.name,
            graph: resource.xml,
          });
          return newMap;
        });
        setCurrentGraphName(resource.name);
        setDraftGraph(null);
        return true;
      } catch (error) {
        window.alert(
          error instanceof Error ? error.message : "Unable to save DCR graph.",
        );
        return false;
      }
    },
    [currentGraphName],
  );

  const deleteGraph = useCallback(async (name: string) => {
    try {
      await deleteDCRGraph(name);
      setGraphs((prev) => {
        const newMap = new Map(prev);
        newMap.delete(name);
        return newMap;
      });
      setCurrentGraphName((current) => (current === name ? null : current));
      return true;
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Unable to delete DCR graph.",
      );
      return false;
    }
  }, []);

  const saveLog = useCallback(
    (name: string, log: EventLog<RoleTrace>) => {
      if (
        !logs.has(name) ||
        name === currentLogName ||
        window.confirm("Overwrite existing log?")
      ) {
        setLogs((prev) => {
          const newMap = new Map(prev);
          newMap.set(name, { name, log });
          return newMap;
        });
        setCurrentLogName(name);
        return true;
      }
      return false;
    },
    [logs, currentLogName],
  );

  const pickGraph = useCallback(
    (name: string | null = null) => {
      if (name && !graphs.has(name)) {
        window.alert("Graph not found!");
        return;
      }
      setCurrentGraphName(name);
      setDraftGraph(null);
    },
    [graphs],
  );

  const openDraftGraph = useCallback((
    name: string,
    graph: string,
    destination: StateEnum = StateEnum.Modeler,
    preserveCurrent = false,
  ) => {
    if (!preserveCurrent) setCurrentGraphName(null);
    setDraftGraph({ name, graph });
    setState(destination);
  }, []);

  const pickLog = useCallback(
    (name: string | null = null) => {
      if (name && !logs.has(name)) {
        window.alert("Log not found!");
        return;
      }
      setCurrentLogName(name);
    },
    [logs],
  );

  const changeMarkerNotation = useCallback((value: unknown) => {
    if (isMarkerNotation(value)) {
      setMarkerNotation(value);
    }
  }, []);

  const changeColoredRelations = useCallback((value: unknown) => {
    if (isColoredRelations(value)) {
      setColoredRelations(value);
    }
  }, []);

  const openChat = useCallback((configuration: ChatLaunchConfig) => {
    setChatLaunch(configuration);
    setState(StateEnum.Chat);
  }, []);

  const stateProps: StateProps = {
    setState,
    openChat,
    savedGraphs: graphs,
    setSavedGraphs: setGraphs,
    savedLogs: logs,
    setSavedLogs: setLogs,
    currentGraph,
    draftGraph,
    openDraftGraph,
    setCurrentGraph: setCurrentGraphName,
    currentLog,
    setCurrentLog: setCurrentLogName,
    saveGraph,
    deleteGraph,
    graphsLoading,
    graphsError,
    reloadGraphs,
    saveLog,
    pickGraph,
    pickLog,
    markerNotation,
    changeMarkerNotation,
    coloredRelations,
    changeColoredRelations,
  };

  switch (state) {
    case StateEnum.Modeler:
      return <ModelerState {...stateProps} />;
    case StateEnum.Home:
      return <HomeState {...stateProps} />;
    case StateEnum.Simulator:
      return <SimulatorState {...stateProps} />;
    case StateEnum.Conformance:
      return <ConformanceCheckingState {...stateProps} />;
    case StateEnum.Discovery:
      return <DiscoveryState {...stateProps} />;
    case StateEnum.EventLogGeneration:
      return <EventLogGenerationState {...stateProps} />;
    case StateEnum.FromText:
      return <FromTextState {...stateProps} />;
    case StateEnum.CitizenInformation:
      return (
        <CitizenInformationState
          {...stateProps}
          citizenInformation={citizenInformation}
          updateCitizenInformation={updateCitizenInformation}
        />
      );
    case StateEnum.Chat:
      return chatLaunch ? (
        <ChatState
          launch={chatLaunch}
          citizenInformation={citizenInformation.text}
          markerNotation={markerNotation}
          coloredRelations={coloredRelations}
          onBack={() => setState(StateEnum.Home)}
        />
      ) : (
        <HomeState {...stateProps} />
      );
  }
};

export default App;
