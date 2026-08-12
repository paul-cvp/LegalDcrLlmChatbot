import styled from "styled-components";

const Loading = styled.div<{ $embedded?: boolean }>`
  z-index: 1000;
  position: ${(props) => (props.$embedded ? "absolute" : "fixed")};
  height: 100%;
  width: 100%;
  top: 0;
  left: 0;
  cursor: wait;
`;

export default Loading;
