import styled from "styled-components";

interface TopRightIconProps {
  children: React.ReactNode;
  embedded?: boolean;
}

const Container = styled.div<{ $embedded: boolean }>`
  position: ${(props) => (props.$embedded ? "absolute" : "fixed")};
  top: 0;
  right: 0;
  overflow: hidden;
  display: flex;
  z-index: 15;
  & > svg {
    background-color: white;
    z-index: 15;
    margin: 0.5rem;
    border: 2px solid black;
    border-radius: 50%;
    padding: 5px;
    font-size: 30px;
    height: 30px;
    width: 30px;
    cursor: pointer;
    &:hover {
      box-shadow: 0px 0px 5px 0px grey;
    }
  }
`;

const TopRightIcons = ({ children, embedded = false }: TopRightIconProps) => {
  return <Container $embedded={embedded}>{children}</Container>;
};

export default TopRightIcons;
