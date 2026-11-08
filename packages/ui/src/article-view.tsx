export function ArticleView(props: {
  title: string;
  author: string;
  date: string;
  category: string;
  image: { url: string; width: number; height: number } | null;
  safeHtml: string;
  tags: readonly { label: string; href: string }[];
}) {
  return (
    <article className="ui-article">
      <p className="ui-article-meta">{props.category}</p>
      <h1 className="ui-shell-title">{props.title}</h1>
      <p className="ui-article-meta">
        {props.author} · {props.date}
      </p>
      {props.image && (
        <img
          className="ui-article-image"
          src={props.image.url}
          width={props.image.width}
          height={props.image.height}
          alt=""
        />
      )}
      <div className="ui-article-body" dangerouslySetInnerHTML={{ __html: props.safeHtml }} />
      {props.tags.length > 0 && (
        <ul className="ui-article-tags">
          {props.tags.map((tag) => (
            <li key={tag.label}>
              <a href={tag.href}>#{tag.label}</a>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
