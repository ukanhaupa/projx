import { Link } from 'react-router-dom';
import { getEntities } from '../entities';

export function Dashboard() {
  const entities = getEntities();

  if (entities.length === 0) {
    return (
      <div>
        <h2>Dashboard</h2>
        <div className='full-page-state'>
          <div>
            <p>
              No entities configured. Define entity models in the backend to get
              started.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2>Dashboard</h2>
      <div className='card-grid' role='list'>
        {entities.map((e) => (
          <Link
            key={e.slug}
            to={`/${e.slug}`}
            className='card'
            role='listitem'
            aria-label={`${e.name} - ${e.fields ? 'Full CRUD' : 'Read-only'}`}
          >
            <h3>{e.name}</h3>
            <p>{e.fields ? 'Full CRUD' : 'Read-only'}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
