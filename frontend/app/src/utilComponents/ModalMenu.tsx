import styled from "styled-components";

import { BiMenu, BiSolidDownArrow, BiSolidRightArrow, BiX } from "react-icons/bi";
import React, {useEffect, useState} from "react";
import { createPortal } from "react-dom";

const MenuIcon = styled(BiMenu)<{ open: boolean }>`
  border-radius: 50%;
  padding: 5px;
  font-size: 30px;
  height: 30px;
  width: 30px;
  color: ${(props) => (props.open ? "White" : "Black")};
  background-color: ${(props) => (props.open ? "Black !important" : "White")};
  cursor: pointer;
`;

const Menu = styled.div`
  position: fixed;
  top: 0;
  right: 0;
  z-index: 1000;
  height: 100vh;
  width: min(30rem, 100%);
  box-shadow: 0px 0px 5px 0px grey;
  display: flex;
  flex-direction: column;
  padding-top: 5rem;
  padding-bottom: 5rem;
  font-size: 20px;
  background-color: white;
  justify-content: space-between;
  box-sizing: border-box;
  overflow: scroll;
`;

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 999;
  background: rgba(16, 24, 40, 0.22);
`;

const CloseButton = styled.button`
  position: absolute;
  top: 1rem;
  right: 1rem;
  border: 0;
  padding: 0.25rem;
  color: #182539;
  background: transparent;
  cursor: pointer;
  font-size: 2rem;
`;

const MenuItem = styled.li<{ $isOpen?: boolean }>`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  padding: 1rem;
  cursor: pointer;
  & > svg {
    font-size: 25px;
  }
  ${(props) =>
    props.$isOpen
      ? `
				background-color: #e6e6e6;
				&:hover {
					color: white;
					background-color: Gainsboro;
				}    
			`
      : `
				&:hover {
					color: white;
					background-color: Gainsboro;
				}    
			`}
`;

const CustomMenuItem = styled.li`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  cursor: pointer;
  box-sizing: border-box;
  & > svg {
    font-size: 25px;
  }
`;

const Divider = styled.div`
  margin: 5px;
  margin-left: auto;
  margin-right: auto;
  border-bottom: 1px solid grey;
  width: 50%;
`;

type RegularModalMenuElement = {
  icon: React.ReactNode;
  text: string;
  onClick: () => void;
};

type CustomModalMenuElement = {
  customElement: React.ReactNode;
};

type ExpandingModalMenuElement = {
  text: string;
  elements: Array<ModalMenuElement>;
};

export type ModalMenuElement =
  | RegularModalMenuElement
  | CustomModalMenuElement
  | ExpandingModalMenuElement;

interface ModalMenuProps {
  elements: Array<ModalMenuElement>;
  bottomElements?: Array<ModalMenuElement>;
  open: boolean;
  setOpen: (val: boolean) => void;
  icon?: React.FC<{onClick: () => void, open: boolean}>;
}

const isRegularElement = (obj: unknown): obj is RegularModalMenuElement => {
  return (obj as RegularModalMenuElement).icon !== undefined;
};

const isExpandingElement = (obj: unknown): obj is ExpandingModalMenuElement => {
  return (obj as ExpandingModalMenuElement).elements !== undefined;
};

const isCustomElement = (obj: unknown): obj is CustomModalMenuElement => {
  return (obj as CustomModalMenuElement).customElement !== undefined;
};

const ModalMenu = ({
  elements,
  bottomElements,
  open,
  setOpen,
  icon,
}: ModalMenuProps) => {
  let Icon: React.FC<{onClick: () => void, open: boolean}> = MenuIcon;
  if(icon) {
    Icon = icon;
  }

  const [openElements, setOpenElements] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open, setOpen]);

  const clickExpanding = (elementId: string) => {
    if (openElements.has(elementId)) {
      const copy = new Set(openElements);
      copy.delete(elementId);
      setOpenElements(copy);
    } else {
      const copy = new Set(openElements);
      copy.add(elementId);
      setOpenElements(copy);
    }
  };

  const renderElement = (element: ModalMenuElement, key: string) => {
    if (isRegularElement(element)) {
      const { icon, text, onClick } = element;
      return (
        <MenuItem key={key} onClick={onClick}>
          <>{icon}</>
          <>{text}</>
        </MenuItem>
      );
    } else if (isExpandingElement(element)) {
      const { text, elements } = element;
      const isOpen = openElements.has(text);
      return (
        <React.Fragment key={key}>
          <MenuItem
            $isOpen={isOpen}
            onClick={() => clickExpanding(text)}
          >
            {isOpen ? <BiSolidDownArrow /> : <BiSolidRightArrow />}
            <>{text}</>
          </MenuItem>
          {isOpen ? (
            <li>
              <ul>{elements.map((child, index) => renderElement(child, `${key}-${index}`))}</ul>
              <Divider />
            </li>
          ) : null}
        </React.Fragment>
      );
    } else if (isCustomElement(element)) {
      return (
        <CustomMenuItem key={key}>
          {element.customElement}
        </CustomMenuItem>
      );
    }
  };

  return (
    <>
      {open ? createPortal(<>
        <Backdrop onClick={() => setOpen(false)} />
        <Menu role="dialog" aria-label="Modeler menu">
          <CloseButton aria-label="Close modeler menu" onClick={() => setOpen(false)}><BiX /></CloseButton>
          <ul>{elements.map((element, index) => renderElement(element, `top-${index}`))}</ul>
          {bottomElements && <ul>{bottomElements.map((element, index) => renderElement(element, `bottom-${index}`))}</ul>}
        </Menu>
      </>,
        document.body,
      ) : null}
      <Icon
        onClick={() => setOpen(!open)}
        open={open}
        data-testid="menu-icon"
      />
    </>
  );
};

export default ModalMenu;
