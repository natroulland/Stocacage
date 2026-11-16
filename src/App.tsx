import WindowFrame from "./components/WindowFrame";
import ImageList from "./components/ImageList";
import "./App.css";

function App() {
  return (
    <WindowFrame title="Stocacage">
      <main className="container">
        <ImageList />
      </main>
    </WindowFrame>
  );
}

export default App;
