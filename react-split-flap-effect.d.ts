declare module "react-split-flap-effect" {
  import * as React from "react";

  export const Presets: {
    NUM: string;
    ALPHANUM: string;
  };

  export type FlapDisplayProps = {
    id?: string;
    className?: string;
    value: string;
    chars?: string;
    words?: string[];
    length: number;
    padChar?: string;
    padMode?: "auto" | "start" | "end";
    timing?: number;
    hinge?: boolean;
    render?: (props: { children: React.ReactNode }) => React.ReactNode;
  };

  export const FlapDisplay: React.ComponentType<FlapDisplayProps>;
}
