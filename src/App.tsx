import { ReactRunner } from "@chub-ai/stages-ts";
import { Stage } from "./Stage";
import { TestStageRunner } from "./TestRunner";

function App() {
  const isDev = (import.meta as any).env.MODE === 'development';
  console.info(`Running in ${(import.meta as any).env.MODE}`);

  return isDev ? <TestStageRunner factory={(data: any) => new Stage(data)} /> :
    <ReactRunner factory={(data: any) => new Stage(data)} />;
}

export default App
