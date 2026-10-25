import { ROUTES } from "../io/routes";
import type { Image } from "../notes/note";
import { useTools } from "./session";

/** The URL a screenshot shows from: the dev server's, or a whole URL as it is, as the
 * workshop's pictures have. */
export const useImageUrl = () => {
  const route = useTools().adapter.channel?.images ?? ROUTES.images;
  return (image: Image) =>
    /^(data|https?):/.test(image.name) ? image.name : `${route}/${image.name}`;
};
