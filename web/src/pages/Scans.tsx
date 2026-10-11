// The scans page: the list at /scans, one scan laid out wide at /scans/:id.

import { useParams } from "react-router";
import { ScanList } from "./scans/ScanList";
import { ScanView } from "./scans/ScanView";

export default function Scans() {
  const { id } = useParams();
  return id ? <ScanView id={id} /> : <ScanList />;
}
