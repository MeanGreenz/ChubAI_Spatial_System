import { ReactRunner } from "@chub-ai/stages-ts";
import { Stage } from "./Stage";
import { TestStageRunner } from "./TestRunner";

function App() {
  const isDev = (import.meta as any).env.MODE === 'development';
  console.info(`Running in ${(import.meta as any).env.MODE}`);

  // @ts-expect-error - Stage constructor type is complex and comes from external library
  const createStage = (data: unknown) => new Stage(data);

  return isDev ? <TestStageRunner factory={createStage} /> :
    <ReactRunner factory={createStage} />;
}

export default App
