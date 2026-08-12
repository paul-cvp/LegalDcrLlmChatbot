import type { StateProps } from "../App";
import FromTextState from "./FromTextState";
import type { CitizenInformationSession } from "./citizenInformationStorage";

interface CitizenInformationStateProps extends StateProps {
  citizenInformation: CitizenInformationSession;
  updateCitizenInformation: (changes: Partial<CitizenInformationSession>) => void;
}

const CitizenInformationState = (props: CitizenInformationStateProps) => (
  <FromTextState {...props} mode="citizen" />
);

export default CitizenInformationState;
