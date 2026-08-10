import type { Navigate } from "../worldRoutes";
import { HomeChoiceView } from "./HomeChoiceView";

export function HomeChoice({ navigate }: { navigate: Navigate }) {
  return (
    <HomeChoiceView
      playHref="/play"
      buildHref="/build"
      onChoosePlay={() => navigate("/play")}
      onChooseBuild={() => navigate("/build")}
    />
  );
}
